"""Fixtures for the cards tests: logged-in clients with the `cards` app, a
temporary CARDS_DATA_DIR and CARDS_SOURCE_DIR, a small catalog, a fake web
(no test reaches the network) and catalog jobs run inline."""

import httpx2
import pytest
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.testclient import TestClient

import app
from core import database
from core.config import settings
from core.security import CSRF_COOKIE
from domains.cards import display
from domains.cards import models as m
from domains.cards.refresh import http as refresh_http
from domains.cards.refresh import jobs
from tests.conftest import login, make_user

URL = "/api/cards"


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    """CARDS_DATA_DIR for this test (images, thumbnails, logos)."""
    path = tmp_path / "cards-data"
    path.mkdir()
    monkeypatch.setattr(settings, "cards_data_dir", str(path))
    return path


@pytest.fixture(autouse=True)
def source_dir(tmp_path, monkeypatch):
    """An empty CARDS_SOURCE_DIR (see write_set)."""
    path = tmp_path / "cards-source"
    path.mkdir()
    monkeypatch.setattr(settings, "cards_source_dir", str(path))
    display._series_names_fr.cache_clear()
    yield path
    display._series_names_fr.cache_clear()


@pytest.fixture
def connections_while_streaming(monkeypatch):
    """Pooled connections checked out as each file or streamed response
    starts sending (should be 0: a slow download must not hold one)."""
    counts = []
    for response_class in (FileResponse, StreamingResponse):
        send = response_class.__call__

        async def counting(self, scope, receive, send_, send=send):
            counts.append(database.engine.pool.checkedout())
            await send(self, scope, receive, send_)

        monkeypatch.setattr(response_class, "__call__", counting)
    return counts


class FakeWeb:
    """Stands in for the pokecardex CDN and TCGdex: tests register responses
    by full URL. Any other request fails the test."""

    def __init__(self):
        self.routes: dict[str, httpx2.Response] = {}
        self.requests: list[str] = []
        # Pooled connections checked out during each request (should be 0).
        self.connections: list[int] = []

    def add(self, url: str, content: bytes = b"\xff\xd8jpeg", status: int = 200):
        self.routes[url] = httpx2.Response(status, content=content)

    def json(self, url: str, data) -> None:
        self.routes[url] = httpx2.Response(200, json=data)

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        url = str(request.url)
        self.requests.append(url)
        self.connections.append(database.engine.pool.checkedout())
        if url not in self.routes:
            raise AssertionError(f"Unexpected external request: {url}")
        return self.routes[url]


@pytest.fixture(autouse=True)
def web(monkeypatch):
    fake = FakeWeb()
    monkeypatch.setattr(refresh_http, "transport", httpx2.MockTransport(fake.handle))
    return fake


@pytest.fixture(autouse=True)
def inline_jobs(monkeypatch):
    """Catalog jobs run inside the request, so it returns once they're done."""
    jobs.reset()
    monkeypatch.setattr(jobs, "spawn", lambda target, *args: target(*args))
    yield
    jobs.reset()


@pytest.fixture
def cards_client():
    """`cards_client(email, **make_user kwargs)`: a client logged in as a new
    user with the `cards` app (unless `apps` says otherwise), sending the
    CSRF header on every request."""
    clients: list[TestClient] = []

    def _make(email: str, **user) -> TestClient:
        created = make_user(email=email, **({"apps": ("cards",)} | user))
        c = TestClient(app.app)
        c.__enter__()
        assert login(c, email=email).status_code == 200
        c.headers["x-csrf-token"] = c.cookies.get(CSRF_COOKIE)
        c.user_id = created.id
        clients.append(c)
        return c

    yield _make
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def client(cards_client):
    """A cards user (overrides the anonymous root `client`)."""
    return cards_client("alice@example.com", pseudo="Alice")


@pytest.fixture
def other_client(cards_client):
    """A second cards user."""
    return cards_client("bob@example.com", pseudo="Bob")


@pytest.fixture
def admin(cards_client):
    return cards_client("root@example.com", pseudo="Root", apps=(), is_admin=True)


@pytest.fixture
def anon():
    with TestClient(app.app) as c:
        yield c


def add_catalog_card(
    set_code="SVI",
    card_number="1",
    name="Sprigatito",
    variants=("standard", "reverse"),
    **fields,
) -> int:
    """Insert a catalog card (+ its variants) directly; returns its id."""
    series = fields.pop("series", "Scarlet & Violet")
    slug = name.lower().replace(" ", "-")
    defaults = {
        "display_name": name,
        "series": series,
        "set_name": "Scarlet & Violet",
        "set_code": set_code,
        "card_number": card_number,
        "image_path": f"{series}/{set_code}/cards/{card_number}_{slug}_standard_EN.jpg",
        "supertype": "Pokémon",
        "rarity": "Common",
        "card_count": 198,
    }
    with database.SessionLocal() as session:
        card = m.CardCatalog(
            name=name,
            **(defaults | fields),
            variants=[m.CardCatalogVariant(variant_type=v) for v in variants],
        )
        session.add(card)
        session.commit()
        return card.id


def own(user_id: int, catalog_id: int, **quantities: int) -> int:
    """Give `user_id` copies of a catalog card, per print
    (`own(uid, cid, standard=2, reverse=1)`); returns the `cards` row id."""
    with database.SessionLocal() as session:
        card = m.Card(
            user_id=user_id,
            catalog_id=catalog_id,
            variant_quantities=[
                m.CardVariantQuantity(variant_type=v, quantity=q)
                for v, q in (quantities or {"standard": 1}).items()
            ],
        )
        session.add(card)
        session.commit()
        return card.id


def set_language(user_id: int, language: str) -> None:
    with database.SessionLocal() as session:
        session.get(m.User, user_id).language = language
        session.commit()


def make_deck(user_id: int, name: str = "Deck", deck_type: str = "normal") -> int:
    with database.SessionLocal() as session:
        deck = m.Deck(user_id=user_id, name=name, deck_type=deck_type)
        session.add(deck)
        session.commit()
        return deck.id


def put_in_deck(deck_id: int, card_id: int, copies: int, variant: str = "standard"):
    with database.SessionLocal() as session:
        session.add(
            m.DeckCard(
                deck_id=deck_id,
                card_id=card_id,
                variant_type=variant,
                quantity_in_deck=copies,
            )
        )
        session.commit()
