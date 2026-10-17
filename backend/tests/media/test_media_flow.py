"""The dev-stack check of step 4 as one test: a media user adds a book and a
film, updates progress, and someone else (first without the media app, then
granted it by an admin) can neither see nor change those entries."""

from fastapi.testclient import TestClient

import app
from core.security import CSRF_COOKIE
from tests.conftest import REGISTER_SECRET
from tests.media.conftest import URL, tmdb_film


def _book(web):
    web.json(
        "openlibrary.org/search.json",
        {"docs": [{"key": "/works/OL20893680W", "title": "Piranesi", "cover_i": 1}]},
    )
    web.json("openlibrary.org/works/OL20893680W.json", {"title": "Piranesi"})
    web.image("covers.openlibrary.org/b/id/1-M.jpg")


def test_add_progress_and_isolation(media_client, anon, web):
    admin = media_client("root@example.com", apps=(), is_admin=True)

    # Search and add a book and a film.
    _book(web)
    hits = admin.get(f"{URL}/search", params={"type": "book", "q": "piranesi"}).json()
    book = admin.post(
        f"{URL}/library/from-search",
        json={
            "source": "openlibrary",
            "external_id": hits[0]["external_id"],
            "type": "book",
        },
    ).json()
    tmdb_film(web, 603)
    film = admin.post(
        f"{URL}/library/from-search",
        json={"source": "tmdb", "external_id": "603", "type": "film"},
    ).json()

    # Update progress.
    assert (
        admin.post(f"{URL}/library/{book['id']}/start").json()["status"]
        == "in_progress"
    )
    assert admin.post(f"{URL}/library/{film['id']}/finish").json()["status"] == "done"
    admin.patch(f"{URL}/library/{film['id']}", json={"rating": 9})
    cover = f"{URL}/items/{film['item']['id']}/cover"
    assert admin.get(cover).status_code == 200

    # Logged out: nothing.
    assert anon.get(f"{URL}/library").status_code == 401
    assert anon.get(cover).status_code == 401

    # Someone signs up: no media access yet.
    with TestClient(app.app) as bob:
        r = bob.post(
            "/api/auth/register",
            json={
                "email": "bob@example.com",
                "password": "bob-password-123",
                "pseudo": "Bob",
            },
            headers={"X-Register-Secret": REGISTER_SECRET},
        )
        assert r.status_code == 201
        bob.headers["x-csrf-token"] = bob.cookies.get(CSRF_COOKIE)
        assert bob.get(f"{URL}/library").status_code == 403

        # The admin grants media: Bob has his own (empty) library and can't
        # read or change the admin's entries.
        r = admin.put(
            f"/api/auth/users/{r.json()['id']}/apps", json={"apps": ["media"]}
        )
        assert r.json()["apps"] == ["media"]
        assert bob.get(f"{URL}/library").json() == []
        entry = f"{URL}/library/{film['id']}"
        assert bob.get(entry).status_code == 404
        assert bob.patch(entry, json={"rating": 1}).status_code == 404
        assert bob.post(f"{URL}/library/{book['id']}/finish").status_code == 404
        assert bob.delete(entry).status_code == 404

        # Adding the same film gives Bob his own entry over the shared item.
        mine = bob.post(
            f"{URL}/library/from-search",
            json={"source": "tmdb", "external_id": "603", "type": "film"},
        ).json()
        assert mine["id"] != film["id"]
        assert (mine["item"]["id"], mine["status"], mine["rating"]) == (
            film["item"]["id"],
            "want",
            None,
        )

    kept = admin.get(entry).json()
    assert (kept["status"], kept["rating"]) == ("done", 9)
