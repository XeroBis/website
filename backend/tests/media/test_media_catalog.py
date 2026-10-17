"""Adding from search: catalog dedupe, covers, and user isolation."""

import httpx2

from tests.media.conftest import TMDB, tmdb_film

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
        json=FILM | {"status": "done", "owned_formats": ["bluray"]},
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
    assert e["owned_formats"] == ["bluray"]

    cover = client.get(f"/api/media/items/{item['id']}/cover")
    assert cover.status_code == 200
    assert cover.headers["content-type"] == "image/jpeg"
    assert "max-age" in cover.headers["cache-control"]
    assert cover.content == b"\xff\xd8fake-jpeg"


def test_add_book_from_open_library(client, web):
    web.json(
        "openlibrary.org/search.json",
        {
            "docs": [
                {
                    "key": "/works/OL20893680W",
                    "title": "Piranesi",
                    "author_name": ["Susanna Clarke"],
                    "first_publish_year": 2020,
                    "cover_i": 10226290,
                    "isbn": ["1635575648", "9781526622440"],
                    "subject": [
                        "form:novel",
                        "genre:fantasy",
                        "Fiction",
                        "nyt:x=2020",
                        "Accessible book",
                    ],
                }
            ]
        },
    )
    web.json(
        "openlibrary.org/works/OL20893680W.json",
        {"title": "Piranesi", "description": {"value": "A house of halls. "}},
    )
    web.image("covers.openlibrary.org/b/id/10226290-M.jpg")

    r = client.post(
        "/api/media/library/from-search",
        json={"source": "openlibrary", "external_id": "OL20893680W", "type": "book"},
    )
    assert r.status_code == 201, r.text
    item = r.json()["item"]
    assert item["creators"] == "Susanna Clarke"
    assert item["isbn"] == "9781526622440"
    assert item["genres"] == ["Fantasy", "Fiction"]
    assert item["synopsis"] == "A house of halls."
    assert item["has_cover"] is True
    assert item["runtime_minutes"] is None
    # No edition matches either language: the work's own title, no French title.
    assert (item["title"], item["title_fr"]) == ("Piranesi", None)


def _ol_work(web, work_id: str, title: str, editions: dict[str, tuple[str, str]]):
    """`editions`: lang param → (edition title, MARC language) Open Library picks."""
    for lang, (edition_title, marc) in editions.items():
        web.json(
            f"openlibrary.org/search.json?lang={lang}",
            {
                "docs": [
                    {
                        "key": f"/works/{work_id}",
                        "title": title,
                        "editions": {
                            "docs": [{"title": edition_title, "language": [marc]}]
                        },
                    }
                ]
            },
        )
    web.json(f"openlibrary.org/works/{work_id}.json", {"title": title})


def test_book_gets_english_and_french_edition_titles(client, web):
    _ol_work(
        web,
        "OL82563W",
        "Harry Potter and the Philosopher's Stone",
        {
            "en": ("Harry Potter and the Sorcerer's Stone", "eng"),
            "fr": ("Harry Potter à l'école des sorciers", "fre"),
        },
    )
    r = client.post(
        "/api/media/library/from-search",
        json={"source": "openlibrary", "external_id": "OL82563W", "type": "book"},
    )
    item = r.json()["item"]
    assert item["title"] == "Harry Potter and the Sorcerer's Stone"
    assert item["title_fr"] == "Harry Potter à l'école des sorciers"


def test_book_french_title_only_from_a_french_edition(client, web):
    # Open Library falls back to another language's edition: not a French title.
    _ol_work(
        web,
        "OL1W",
        "Piranesi",
        {"en": ("Piranesi", "eng"), "fr": ("Piranesi (Large print)", "eng")},
    )
    r = client.post(
        "/api/media/library/from-search",
        json={"source": "openlibrary", "external_id": "OL1W", "type": "book"},
    )
    assert r.json()["item"]["title_fr"] is None


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
    entry_id = add_manual(title="Mine", owned_formats=["ebook"])["id"]
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
