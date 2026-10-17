from datetime import date

import httpx2

from tests.media.conftest import TMDB, tmdb_film

TODAY = date.today()


def test_update_rating_notes_formats(client, add_manual):
    entry_id = add_manual()["id"]
    r = client.patch(
        f"/api/media/library/{entry_id}",
        json={
            "rating": 7,
            "notes": "  lovely  ",
            "owned_formats": ["paperback", "ebook", "paperback"],
        },
    )
    assert r.status_code == 200
    e = r.json()
    assert (e["rating"], e["notes"], e["owned_formats"]) == (
        7,
        "lovely",
        ["paperback", "ebook"],
    )

    # Only sent fields change; null clears the rating.
    e = client.patch(f"/api/media/library/{entry_id}", json={"rating": None}).json()
    assert e["rating"] is None
    assert e["notes"] == "lovely"


def test_invalid_rating_and_format_are_rejected(client, add_manual):
    entry_id = add_manual()["id"]
    assert (
        client.patch(f"/api/media/library/{entry_id}", json={"rating": 11}).status_code
        == 422
    )
    assert (
        client.patch(f"/api/media/library/{entry_id}", json={"rating": 0}).status_code
        == 422
    )
    r = client.patch(f"/api/media/library/{entry_id}", json={"owned_formats": ["vhs"]})
    assert r.status_code == 422


def test_manual_add_requires_a_title(client):
    r = client.post("/api/media/library/manual", json={"type": "book", "title": "  "})
    assert r.status_code == 422


def test_manual_add_fields(add_manual):
    e = add_manual(
        type="film",
        title="Home movie",
        creators="Me",
        year=2020,
        genres=["Family", "Family"],
        owned_formats=["dvd"],
    )
    item = e["item"]
    assert (item["source"], item["external_id"], item["has_cover"]) == (
        "manual",
        None,
        False,
    )
    assert (item["creators"], item["year"], item["genres"]) == ("Me", 2020, ["Family"])
    assert e["owned_formats"] == ["dvd"]


# ── sessions ----------------------------------------------------------------


def test_add_past_session_and_edit_it(client, add_manual):
    entry_id = add_manual()["id"]
    r = client.post(
        f"/api/media/library/{entry_id}/sessions",
        json={"started_on": "2019-01-02", "finished_on": "2019-02-03"},
    )
    assert r.status_code == 201
    session_id = r.json()["sessions"][0]["id"]
    assert r.json()["last_finished_on"] == "2019-02-03"

    r = client.put(
        f"/api/media/library/{entry_id}/sessions/{session_id}",
        json={"started_on": None, "finished_on": "2018-05-05"},
    )
    assert r.json()["sessions"][0]["started_on"] is None

    r = client.delete(f"/api/media/library/{entry_id}/sessions/{session_id}")
    assert r.status_code == 200
    assert r.json()["sessions"] == []


def test_session_cannot_finish_before_it_starts(client, add_manual):
    entry_id = add_manual()["id"]
    r = client.post(
        f"/api/media/library/{entry_id}/sessions",
        json={"started_on": "2020-05-02", "finished_on": "2020-05-01"},
    )
    assert r.status_code == 422


def test_only_one_open_session(client, add_manual):
    entry_id = add_manual()["id"]
    open_one = client.post(f"/api/media/library/{entry_id}/start").json()["sessions"][0]
    r = client.post(
        f"/api/media/library/{entry_id}/sessions", json={"started_on": "2020-01-01"}
    )
    assert r.status_code == 409

    past = client.post(
        f"/api/media/library/{entry_id}/sessions",
        json={"started_on": "2020-01-01", "finished_on": "2020-01-10"},
    ).json()
    past_id = next(s["id"] for s in past["sessions"] if s["id"] != open_one["id"])
    r = client.put(
        f"/api/media/library/{entry_id}/sessions/{past_id}",
        json={"started_on": "2020-01-01", "finished_on": None},
    )
    assert r.status_code == 409
    # Re-saving the open session itself is fine.
    r = client.put(
        f"/api/media/library/{entry_id}/sessions/{open_one['id']}",
        json={"started_on": "2026-01-01", "finished_on": None},
    )
    assert r.status_code == 200


def test_delete_entry_removes_sessions_keeps_catalog(client, web):
    tmdb_film(web, 603)
    body = {"source": "tmdb", "external_id": "603", "type": "film"}
    entry = client.post("/api/media/library/from-search", json=body).json()
    client.post(f"/api/media/library/{entry['id']}/start")

    assert client.delete(f"/api/media/library/{entry['id']}").status_code == 204
    assert client.get(f"/api/media/library/{entry['id']}").status_code == 404

    # Re-adding reuses the catalog row without calling TMDB again.
    web.routes.clear()
    again = client.post("/api/media/library/from-search", json=body)
    assert again.status_code == 201
    assert again.json()["item"]["id"] == entry["item"]["id"]
    assert again.json()["sessions"] == []


# ── list, filters, sort -----------------------------------------------------


def _titles(client, **params):
    return [
        e["item"]["title"]
        for e in client.get("/api/media/library", params=params).json()
    ]


def test_filters_and_sort(client, add_manual):
    a = add_manual(title="Alpha", creators="Zed Author", year=2001, genres=["SF"])
    b = add_manual(type="film", title="Bravo", year=1990, owned_formats=["dvd"])
    c = add_manual(type="series", title="charlie", year=2010, genres=["Drama", "SF"])
    client.patch(f"/api/media/library/{a['id']}", json={"rating": 6})
    client.patch(f"/api/media/library/{c['id']}", json={"rating": 9})
    client.post(f"/api/media/library/{b['id']}/start")
    client.post(
        f"/api/media/library/{a['id']}/sessions",
        json={"started_on": "2020-01-01", "finished_on": "2020-01-02"},
    )
    client.post(
        f"/api/media/library/{c['id']}/sessions",
        json={"started_on": "2021-01-01", "finished_on": "2021-01-02"},
    )

    assert _titles(client) == ["charlie", "Bravo", "Alpha"]
    assert _titles(client, sort="title") == ["Alpha", "Bravo", "charlie"]
    assert _titles(client, sort="year") == ["charlie", "Alpha", "Bravo"]
    assert _titles(client, sort="rating") == ["charlie", "Alpha", "Bravo"]
    assert _titles(client, sort="finished") == ["charlie", "Alpha", "Bravo"]

    assert _titles(client, type="film") == ["Bravo"]
    assert _titles(client, status="in_progress") == ["Bravo"]
    assert _titles(client, owned="true") == ["Bravo"]
    assert _titles(client, owned="false") == ["charlie", "Alpha"]
    assert _titles(client, genre="SF") == ["charlie", "Alpha"]
    assert _titles(client, q="zed") == ["Alpha"]
    assert _titles(client, q="CHAR") == ["charlie"]

    assert client.get("/api/media/library/genres").json() == ["Drama", "SF"]


# ── search ------------------------------------------------------------------


def test_search_film_marks_items_already_in_library(client, web):
    web.json(
        f"{TMDB}/search/movie",
        {
            "results": [
                {
                    "id": 603,
                    "title": "Matrix",
                    "release_date": "1999-03-31",
                    "poster_path": "/p.jpg",
                },
                {"id": 604, "title": "Matrix Reloaded", "release_date": ""},
            ]
        },
    )
    web.json(f"{TMDB}/movie/603/credits", {"crew": [{"job": "Director", "name": "L"}]})
    web.json(f"{TMDB}/movie/604/credits", {"crew": []})
    tmdb_film(web, 603)
    client.post(
        "/api/media/library/from-search",
        json={"source": "tmdb", "external_id": "603", "type": "film"},
    )

    r = client.get("/api/media/search", params={"type": "film", "q": "matrix"})
    assert r.status_code == 200
    hits = r.json()
    assert [(h["title"], h["year"], h["creators"]) for h in hits] == [
        ("Matrix", 1999, "L"),
        ("Matrix Reloaded", None, None),
    ]
    assert hits[0]["thumb_url"] == "https://image.tmdb.org/t/p/w154/p.jpg"
    assert hits[0]["library_entry_id"] is not None
    assert hits[1]["library_entry_id"] is None

    search_request = next(r for r in web.requests if "search" in r.url.path)
    assert search_request.headers["authorization"] == "Bearer test-token"
    assert search_request.url.params["language"] == "fr-FR"  # the user's saved language
    assert "test-token" not in str(search_request.url)


def test_search_source_failure_is_502(client, web):
    web.routes[f"{TMDB}/search/tv"] = httpx2.Response(500)
    r = client.get("/api/media/search", params={"type": "series", "q": "x"})
    assert r.status_code == 502


def test_search_book_open_library(client, web):
    web.json(
        "openlibrary.org/search.json",
        {
            "docs": [
                {
                    "key": "/works/OL1W",
                    "title": "Piranesi",
                    "author_name": ["S. Clarke"],
                    "first_publish_year": 2020,
                    "cover_i": 42,
                    # Open Library's pick for lang=fr is an English edition.
                    "editions": {"docs": [{"title": "Piranesi", "language": ["eng"]}]},
                },
            ]
        },
    )
    hits = client.get(
        "/api/media/search", params={"type": "book", "q": "piranesi"}
    ).json()
    assert hits == [
        {
            "source": "openlibrary",
            "external_id": "OL1W",
            "type": "book",
            "title": "Piranesi",
            "year": 2020,
            "creators": "S. Clarke",
            "thumb_url": "https://covers.openlibrary.org/b/id/42-M.jpg?default=false",
            "library_entry_id": None,
        }
    ]


def test_search_book_titles_follow_the_viewer_language(client, other_client, web):
    doc = {
        "key": "/works/OL82563W",
        "title": "Harry Potter and the Philosopher's Stone",
        "editions": {
            "docs": [
                {"title": "Harry Potter à l'école des sorciers", "language": ["fre"]}
            ]
        },
    }
    web.json("openlibrary.org/search.json", {"docs": [doc]})
    fr = client.get("/api/media/search", params={"type": "book", "q": "harry"}).json()
    en = other_client.get(
        "/api/media/search", params={"type": "book", "q": "harry"}
    ).json()
    assert fr[0]["title"] == "Harry Potter à l'école des sorciers"
    # The French edition isn't used for an English viewer.
    assert en[0]["title"] == "Harry Potter and the Philosopher's Stone"
    assert [r.url.params["lang"] for r in web.requests] == ["fr", "en"]


def _set_title_fr(entry: dict, title_fr: str) -> None:
    from core.database import SessionLocal
    from domains.media.models import MediaItem

    with SessionLocal() as db:
        db.get(MediaItem, entry["item"]["id"]).title_fr = title_fr
        db.commit()


def test_text_search_and_title_sort_use_the_viewer_language(client, other_client):
    # `client` is French, `other_client` English.
    for c in (client, other_client):
        wall = c.post(
            "/api/media/library/manual", json={"type": "book", "title": "The Wall"}
        ).json()
        _set_title_fr(wall, "Le Mur")
        c.post("/api/media/library/manual", json={"type": "book", "title": "Mountain"})

    # "Le Mur" < "Mountain" in French; "Mountain" < "The Wall" in English.
    assert _titles(client, sort="title") == ["The Wall", "Mountain"]
    assert _titles(other_client, sort="title") == ["Mountain", "The Wall"]
    # The French title is searchable for everyone.
    assert _titles(client, q="mur") == ["The Wall"]
    assert _titles(other_client, q="mur") == ["The Wall"]
