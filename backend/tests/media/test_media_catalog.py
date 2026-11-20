"""Adding from search: catalog dedupe, covers, and user isolation."""

import httpx2

from tests.media.conftest import TMDB, gb_book, tmdb_film

FILM = {"source": "tmdb", "external_id": "603", "type": "film"}


def _media_item_count():
    from core.database import SessionLocal
    from domains.media.models import MediaItem

    with SessionLocal() as db:
        return db.query(MediaItem).count()


def test_add_film_from_tmdb_fills_metadata_and_cover(client, web):
    tmdb_film(web, 603)
    r = client.post(
        "/api/media/library/from-search",
        json=FILM | {"status": "done"},
    )
    assert r.status_code == 201
    e = r.json()
    item = e["item"]
    # English by default, French alongside; the original equals the English title.
    assert (item["title"], item["title_fr"]) == ("The Matrix", "Matrix")
    assert item["original_title"] is None
    assert (item["synopsis"], item["synopsis_fr"]) == ("Neo.", "Néo.")
    languages = {
        r.url.params.get("language") for r in web.requests if "/movie/603" in r.url.path
    }
    assert languages == {"en-US", "fr-FR"}
    assert item["creators"] == "Lana Wachowski, Lilly Wachowski"
    assert item["genres"] == ["Action", "Science-Fiction"]
    assert (item["year"], item["runtime_minutes"]) == (1999, 136)
    assert item["season_episode_counts"] is None
    assert item["has_cover"] is True
    assert e["status"] == "done"
    assert e["owned"] is False

    cover = client.get(f"/api/media/items/{item['id']}/cover")
    assert cover.status_code == 200
    assert cover.headers["content-type"] == "image/jpeg"
    assert "max-age" in cover.headers["cache-control"]
    assert cover.content == b"\xff\xd8fake-jpeg"


def test_add_book_from_google_books(client, web):
    gb_book(
        web,
        "zyTCAlFPjgYC",
        publishedDate="2020-09-15",
        authors=["Susanna Clarke"],
        industryIdentifiers=[
            {"type": "ISBN_10", "identifier": "1635575648"},
            {"type": "ISBN_13", "identifier": "9781526622440"},
        ],
        categories=["Fiction / Fantasy / General", "Fiction / Literary"],
        description="<p>A house of <b>halls</b>.</p><p>Tides &amp; statues. </p>",
        imageLinks={
            "thumbnail": "http://books.google.com/books/content?id=zyTCAlFPjgYC&zoom=1&edge=curl",
            "medium": "http://books.google.com/books/content?id=zyTCAlFPjgYC&zoom=3&edge=curl",
        },
    )
    web.image("books.google.com/books/content")

    r = client.post(
        "/api/media/library/from-search",
        json={"source": "googlebooks", "external_id": "zyTCAlFPjgYC", "type": "book"},
    )
    assert r.status_code == 201, r.text
    item = r.json()["item"]
    # The edition's own title, whatever the viewer's language.
    assert (item["title"], item["title_fr"]) == ("Piranesi", None)
    assert item["creators"] == "Susanna Clarke"
    assert item["year"] == 2020
    assert item["isbn"] == "9781526622440"
    assert item["genres"] == ["Fiction", "Fantasy", "Literary"]
    assert item["synopsis"] == "A house of halls.\nTides & statues."
    assert item["has_cover"] is True
    assert item["runtime_minutes"] is None
    details = next(r for r in web.requests if r.url.path.endswith("/zyTCAlFPjgYC"))
    assert details.headers["x-goog-api-key"] == "test-key"
    assert "test-key" not in str(details.url)
    cover = next(r for r in web.requests if r.url.host == "books.google.com")
    # The largest image, over HTTPS, without the page curl.
    assert (
        str(cover.url)
        == "https://books.google.com/books/content?id=zyTCAlFPjgYC&zoom=3"
    )


def test_book_without_key_is_502(client, monkeypatch):
    monkeypatch.setattr(
        "domains.media.sources.googlebooks.settings.google_books_api_key", ""
    )
    r = client.post(
        "/api/media/library/from-search",
        json={"source": "googlebooks", "external_id": "zyTCAlFPjgYC", "type": "book"},
    )
    assert r.status_code == 502
    assert r.json()["detail"] == "GOOGLE_BOOKS_API_KEY is not configured"


def test_missing_cover_falls_back_to_placeholder(client, web):
    tmdb_film(web, 603)
    web.routes["image.tmdb.org/t/p/w342/m603.jpg"] = httpx2.Response(404)
    item = client.post("/api/media/library/from-search", json=FILM).json()["item"]
    assert item["has_cover"] is False
    assert client.get(f"/api/media/items/{item['id']}/cover").status_code == 404


def test_source_must_match_type(client):
    r = client.post(
        "/api/media/library/from-search",
        json={"source": "tmdb", "external_id": "1", "type": "book"},
    )
    assert r.status_code == 422


def test_adding_twice_returns_existing_entry(client, web):
    tmdb_film(web, 603)
    first = client.post("/api/media/library/from-search", json=FILM)
    second = client.post(
        "/api/media/library/from-search", json=FILM | {"status": "done"}
    )
    assert (first.status_code, second.status_code) == (201, 200)
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["status"] == "want"  # untouched
    assert _media_item_count() == 1
    assert len(client.get("/api/media/library").json()) == 1


def test_second_user_reuses_catalog_row(client, other_client, web):
    tmdb_film(web, 603)
    mine = client.post("/api/media/library/from-search", json=FILM).json()
    calls = len(web.requests)
    theirs = other_client.post("/api/media/library/from-search", json=FILM)
    assert theirs.status_code == 201
    assert theirs.json()["id"] != mine["id"]
    assert theirs.json()["item"]["id"] == mine["item"]["id"]
    assert len(web.requests) == calls  # no second TMDB fetch
    assert _media_item_count() == 1


def test_user_isolation(client, other_client, add_manual):
    entry_id = add_manual(title="Mine", owned=True)["id"]
    client.post(f"/api/media/library/{entry_id}/finish")
    session_id = client.get(f"/api/media/library/{entry_id}").json()["sessions"][0][
        "id"
    ]

    base = f"/api/media/library/{entry_id}"
    assert other_client.get(base).status_code == 404
    assert other_client.patch(base, json={"rating": 1}).status_code == 404
    assert other_client.delete(base).status_code == 404
    for action in ("start", "finish", "drop", "next-episode"):
        assert other_client.post(f"{base}/{action}").status_code == 404
    assert other_client.post(f"{base}/sessions", json={}).status_code == 404
    session = f"{base}/sessions/{session_id}"
    assert other_client.put(session, json={}).status_code == 404
    assert other_client.delete(session).status_code == 404

    assert other_client.get("/api/media/library").json() == []
    assert other_client.get("/api/media/library/genres").json() == []

    # And nothing changed for the owner.
    mine = client.get(base).json()
    assert (mine["rating"], mine["status"], len(mine["sessions"])) == (None, "done", 1)


def test_search_result_not_marked_for_other_users(client, other_client, web):
    tmdb_film(web, 603)
    client.post("/api/media/library/from-search", json=FILM)
    web.json(f"{TMDB}/search/movie", {"results": [{"id": 603, "title": "Matrix"}]})
    web.json(f"{TMDB}/movie/603/credits", {"crew": []})
    hits = other_client.get(
        "/api/media/search", params={"type": "film", "q": "m"}
    ).json()
    assert hits[0]["library_entry_id"] is None
