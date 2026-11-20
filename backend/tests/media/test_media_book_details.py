"""Editing a book's catalog fields: `PUT /library/{id}/item`."""

from tests.media.conftest import URL, gb_book

BOOK = {"source": "googlebooks", "external_id": "zyTCAlFPjgYC", "type": "book"}
EDIT = {
    "title": "  Piranesi (edited)  ",
    "creators": " Susanna Clarke ",
    "year": 2021,
    "isbn": "978-1-5266-2244-0",
    "genres": [" Fantasy ", "fantasy", "Fantasy", "", "Mystery"],
    "synopsis": " A house of halls. ",
}


def _add_book(client, web) -> dict:
    gb_book(web, "zyTCAlFPjgYC", publishedDate="2020", authors=["S. Clarke"])
    return client.post(f"{URL}/library/from-search", json=BOOK).json()


def test_edit_book_details(client, web):
    entry = _add_book(client, web)
    r = client.put(f"{URL}/library/{entry['id']}/item", json=EDIT)
    assert r.status_code == 200, r.text
    item = r.json()["item"]
    assert item["title"] == "Piranesi (edited)"
    assert item["creators"] == "Susanna Clarke"
    assert item["year"] == 2021
    assert item["isbn"] == "9781526622440"
    # Repeats are case-sensitive, like the manual add.
    assert item["genres"] == ["Fantasy", "fantasy", "Mystery"]
    assert item["synopsis"] == "A house of halls."
    # Still linked to its source, so adding it again reuses the row.
    assert (item["source"], item["external_id"]) == ("googlebooks", "zyTCAlFPjgYC")
    assert client.get(f"{URL}/library/{entry['id']}").json()["item"] == item


def test_blank_fields_clear(client, web):
    entry = _add_book(client, web)
    r = client.put(
        f"{URL}/library/{entry['id']}/item",
        json={"title": "Piranesi", "creators": " ", "isbn": "", "synopsis": ""},
    )
    item = r.json()["item"]
    assert (item["creators"], item["year"], item["isbn"], item["synopsis"]) == (
        None,
        None,
        None,
        None,
    )
    assert item["genres"] == []


def test_edit_is_shared_with_every_owner(client, other_client, web):
    entry = _add_book(client, web)
    theirs = other_client.post(f"{URL}/library/from-search", json=BOOK).json()
    client.put(f"{URL}/library/{entry['id']}/item", json={"title": "Renamed"})
    assert (
        other_client.get(f"{URL}/library/{theirs['id']}").json()["item"]["title"]
        == "Renamed"
    )


def test_invalid_details_are_422(client, web, add_manual):
    entry = _add_book(client, web)
    url = f"{URL}/library/{entry['id']}/item"
    for body in (
        {"title": "  "},
        {"title": "x" * 501},
        {"title": "T", "year": 10000},
        {"title": "T", "isbn": "9781526622441"},  # wrong check digit
        {"title": "T", "isbn": "12345"},
        {"title": "T", "genres": ["g"] * 21},
        {"title": "T", "genres": ["x" * 101]},
    ):
        assert client.put(url, json=body).status_code == 422, body
    assert client.get(f"{URL}/library/{entry['id']}").json()["item"]["title"] == (
        "Piranesi"
    )


def test_only_books(client, add_manual):
    film = add_manual(type="film", title="Film")
    r = client.put(f"{URL}/library/{film['id']}/item", json={"title": "New"})
    assert r.status_code == 422


def test_someone_elses_entry_is_404(client, other_client, web):
    entry = _add_book(client, web)
    r = other_client.put(f"{URL}/library/{entry['id']}/item", json={"title": "Mine"})
    assert r.status_code == 404
