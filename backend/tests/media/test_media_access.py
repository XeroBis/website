"""Who can call `/api/media`: a session with the `media` app (or admin), CSRF
on unsafe methods. Anyone else's entries are covered in test_media_catalog."""

import pytest

from domains.media import refresh
from tests.media.conftest import URL, tmdb_film

FILM = {"source": "tmdb", "external_id": "603", "type": "film"}

# Every route, with an id that exists in `entry` (filled by the test).
ROUTES = [
    ("GET", "/search?type=film&q=x"),
    ("POST", "/library/from-search"),
    ("POST", "/library/manual"),
    ("GET", "/library"),
    ("GET", "/library/genres"),
    ("GET", "/library/{id}"),
    ("PATCH", "/library/{id}"),
    ("DELETE", "/library/{id}"),
    ("POST", "/library/{id}/start"),
    ("POST", "/library/{id}/finish"),
    ("POST", "/library/{id}/drop"),
    ("POST", "/library/{id}/next-episode"),
    ("POST", "/library/{id}/sessions"),
    ("PUT", "/library/{id}/sessions/{sid}"),
    ("DELETE", "/library/{id}/sessions/{sid}"),
    ("GET", "/items/{item}/cover"),
]
UNSAFE = [(m, p) for m, p in ROUTES if m != "GET"]


@pytest.fixture
def entry(client, web) -> dict:
    """The client's film, finished (so it has a session) with a cover."""
    tmdb_film(web, 603)
    e = client.post(f"{URL}/library/from-search", json=FILM).json()
    return client.post(f"{URL}/library/{e['id']}/finish").json()


def _url(path: str, entry: dict) -> str:
    return URL + path.format(
        id=entry["id"], sid=entry["sessions"][0]["id"], item=entry["item"]["id"]
    )


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_anonymous_is_401(anon, entry, method, path):
    r = anon.request(method, _url(path, entry), json={})
    assert r.status_code == 401


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_without_the_media_app_is_403(media_client, entry, method, path):
    outsider = media_client("eve@example.com", apps=("cards",))
    r = outsider.request(method, _url(path, entry), json={})
    assert r.status_code == 403
    assert r.json()["detail"] == "No access to this app"


@pytest.mark.parametrize(("method", "path"), UNSAFE)
def test_unsafe_routes_need_csrf(client, entry, method, path):
    r = client.request(
        method, _url(path, entry), json={}, headers={"x-csrf-token": "wrong"}
    )
    assert r.status_code == 403
    assert "CSRF" in r.json()["detail"]
    # Nothing changed.
    assert client.get(_url("/library/{id}", entry)).json() == entry


def test_admin_without_grant_has_a_library(media_client):
    admin = media_client("root@example.com", apps=(), is_admin=True)
    r = admin.post(f"{URL}/library/manual", json={"type": "book", "title": "Mine"})
    assert r.status_code == 201
    assert [e["item"]["title"] for e in admin.get(f"{URL}/library").json()] == ["Mine"]


def test_other_users_cover_is_shared(client, other_client, entry):
    """Covers belong to the shared catalog, not to an entry."""
    r = other_client.get(_url("/items/{item}/cover", entry))
    assert r.status_code == 200
    assert r.headers["cache-control"] == "private, max-age=31536000, immutable"


def test_unknown_cover_is_404(client):
    assert client.get(f"{URL}/items/999/cover").status_code == 404


def test_search_without_tmdb_token_is_502_books_still_work(client, web, monkeypatch):
    monkeypatch.setattr(
        "domains.media.sources.tmdb.settings.tmdb_read_access_token", ""
    )
    r = client.get(f"{URL}/search", params={"type": "film", "q": "matrix"})
    assert r.status_code == 502
    assert r.json()["detail"] == "TMDB_READ_ACCESS_TOKEN is not configured"

    web.json("openlibrary.org/search.json", {"docs": []})
    r = client.get(f"{URL}/search", params={"type": "book", "q": "piranesi"})
    assert r.status_code == 200


def test_search_validation(client):
    assert (
        client.get(f"{URL}/search", params={"type": "game", "q": "x"}).status_code
        == 422
    )
    assert (
        client.get(f"{URL}/search", params={"type": "book", "q": ""}).status_code == 422
    )
    assert (
        client.get(f"{URL}/search", params={"type": "book", "q": "x" * 201}).status_code
        == 422
    )


def test_season_and_episode_are_for_series_only(client, add_manual):
    film = add_manual(type="film")
    r = client.patch(f"{URL}/library/{film['id']}", json={"current_season": 2})
    assert r.status_code == 422


def test_refresh_updates_source_items_and_skips_manual(client, web, add_manual):
    tmdb_film(web, 603)
    film = client.post(f"{URL}/library/from-search", json=FILM).json()
    manual = add_manual(title="Hand made")

    tmdb_film(web, 603, title="The Matrix (Remastered)", title_fr="Matrix (Remaster)")
    web.requests.clear()
    refresh.main()

    item = client.get(f"{URL}/library/{film['id']}").json()["item"]
    assert (item["title"], item["title_fr"]) == (
        "The Matrix (Remastered)",
        "Matrix (Remaster)",
    )
    assert item["has_cover"] is True  # covers are left alone
    assert not any("image" in r.url.host for r in web.requests)
    assert client.get(f"{URL}/library/{manual['id']}").json()["item"]["title"] == (
        "Hand made"
    )
