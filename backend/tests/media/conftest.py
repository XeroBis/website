"""Fixtures for the media tests: logged-in clients with the `media` app, and a
fake TMDB / Open Library (no test ever reaches the real APIs)."""

import httpx2
import pytest
from fastapi.testclient import TestClient

import app
from core import database
from core.models import User
from core.security import CSRF_COOKIE
from domains.media.sources import http as source_http
from tests.conftest import login, make_user


def _media_client(email: str, language: str = "fr", **user) -> TestClient:
    created = make_user(email=email, **({"apps": ("media",)} | user))
    with database.SessionLocal() as db:
        db.get(User, created.id).language = language
        db.commit()
    c = TestClient(app.app)
    c.__enter__()
    assert login(c, email=email).status_code == 200
    c.headers["x-csrf-token"] = c.cookies.get(CSRF_COOKIE)
    return c


@pytest.fixture
def media_client():
    """`media_client(email, language="fr", **make_user kwargs)`: a client
    logged in as a new user with the `media` app (unless `apps` says
    otherwise), sending the CSRF header on every request."""
    clients: list[TestClient] = []

    def _make(email: str, language: str = "fr", **user) -> TestClient:
        clients.append(_media_client(email, language, **user))
        return clients[-1]

    yield _make
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def client(media_client):
    """French-speaking media user (overrides the anonymous root `client`)."""
    return media_client("alice@example.com", "fr")


@pytest.fixture
def other_client(media_client):
    """A second, English-speaking media user."""
    return media_client("bob@example.com", "en")


@pytest.fixture
def anon():
    with TestClient(app.app) as c:
        yield c


class FakeWeb:
    """Stands in for TMDB/Open Library: tests register responses per path.

    Any request without a registered response fails the test.
    """

    def __init__(self):
        self.routes: dict[str, httpx2.Response] = {}
        self.requests: list[httpx2.Request] = []
        # Pooled connections checked out during each request (should be 0).
        self.connections: list[int] = []

    def json(self, url: str, data) -> None:
        self.routes[url] = httpx2.Response(200, json=data)

    def image(self, url: str, data: bytes = b"\xff\xd8fake-jpeg") -> None:
        self.routes[url] = httpx2.Response(
            200, content=data, headers={"content-type": "image/jpeg"}
        )

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        """Routes are `host/path`, optionally with `?language=` (TMDB) or
        `?lang=` (Open Library) to answer per language."""
        self.connections.append(database.engine.pool.checkedout())
        self.requests.append(request)
        key = f"{request.url.host}{request.url.path}"
        params = request.url.params
        for name in ("language", "lang"):
            if name in params and f"{key}?{name}={params[name]}" in self.routes:
                return self.routes[f"{key}?{name}={params[name]}"]
        if key not in self.routes:
            raise AssertionError(f"Unexpected external request: {request.url}")
        return self.routes[key]


@pytest.fixture(autouse=True)
def web(monkeypatch):
    fake = FakeWeb()
    monkeypatch.setattr(source_http, "transport", httpx2.MockTransport(fake.handle))
    monkeypatch.setattr(
        "domains.media.sources.tmdb.settings.tmdb_read_access_token", "test-token"
    )
    return fake


# ── fake source payloads ─────────────────────────────────────────────────────

TMDB = "api.themoviedb.org/3"
TMDB_IMG = "image.tmdb.org/t/p"
URL = "/api/media"


def tmdb_series(web: FakeWeb, tmdb_id: int, counts: list[int], title="Show"):
    """Register a TMDB series; `counts` = episodes per season (plus specials
    and an announced empty season, which must be ignored)."""
    seasons = [{"season_number": 0, "episode_count": 3}]
    seasons += [
        {"season_number": n, "episode_count": c} for n, c in enumerate(counts, 1)
    ]
    seasons.append({"season_number": len(counts) + 1, "episode_count": 0})
    web.json(f"{TMDB}/tv/{tmdb_id}?language=fr-FR", {"name": title, "overview": ""})
    web.json(
        f"{TMDB}/tv/{tmdb_id}?language=en-US",
        {
            "name": title,
            "original_name": title,
            "first_air_date": "2022-02-17",
            "overview": "Office workers.",
            "genres": [{"name": "Drama"}],
            "created_by": [{"name": "Dan Erickson"}],
            "seasons": seasons,
            "poster_path": f"/tv{tmdb_id}.jpg",
        },
    )
    web.image(f"{TMDB_IMG}/w342/tv{tmdb_id}.jpg")


def tmdb_film(
    web: FakeWeb,
    tmdb_id: int,
    title="The Matrix",
    title_fr="Matrix",
    original="The Matrix",
):
    web.json(
        f"{TMDB}/movie/{tmdb_id}?language=fr-FR",
        {"title": title_fr, "original_title": original, "overview": "Néo."},
    )
    web.json(
        f"{TMDB}/movie/{tmdb_id}?language=en-US",
        {
            "title": title,
            "original_title": original,
            "release_date": "1999-03-31",
            "overview": "Neo.",
            "runtime": 136,
            "genres": [{"name": "Action"}, {"name": "Science-Fiction"}],
            "poster_path": f"/m{tmdb_id}.jpg",
            "credits": {
                "crew": [
                    {"job": "Director", "name": "Lana Wachowski"},
                    {"job": "Director", "name": "Lilly Wachowski"},
                    {"job": "Producer", "name": "Joel Silver"},
                ]
            },
        },
    )
    web.image(f"{TMDB_IMG}/w342/m{tmdb_id}.jpg")


@pytest.fixture
def add_series(client, web):
    def _add(counts: list[int], tmdb_id: int = 100, **body) -> dict:
        tmdb_series(web, tmdb_id, counts)
        r = client.post(
            f"{URL}/library/from-search",
            json={"source": "tmdb", "external_id": str(tmdb_id), "type": "series"}
            | body,
        )
        assert r.status_code == 201, r.text
        return r.json()

    return _add


@pytest.fixture
def add_manual(client):
    def _add(type="book", title="Manual", **body) -> dict:
        r = client.post(
            f"{URL}/library/manual", json={"type": type, "title": title} | body
        )
        assert r.status_code == 201, r.text
        return r.json()

    return _add
