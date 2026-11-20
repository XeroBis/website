"""Book series: grouping, volume order, bulk marking and ownership rules."""

URL = "/api/media"


def _series(client, name="One Piece") -> dict:
    r = client.post(f"{URL}/series", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def _volume(add_manual, series_id, volume, title=None, **body):
    return add_manual(
        title=title or f"One Piece {volume}",
        series_id=series_id,
        series_volume=volume,
        **body,
    )


def test_create_list_and_names(client, other_client):
    s = _series(client, "  One Piece ")
    assert s == {
        "id": s["id"],
        "name": "One Piece",
        "volumes": 0,
        "read": 0,
        "owned": 0,
        "cover_item": None,
    }
    assert client.post(f"{URL}/series", json={"name": "one piece"}).status_code == 409
    assert client.post(f"{URL}/series", json={"name": " "}).status_code == 422
    # Names are per user.
    _series(other_client, "One Piece")
    _series(client, "Dune")
    assert [x["name"] for x in client.get(f"{URL}/series").json()] == [
        "Dune",
        "One Piece",
    ]


def test_volumes_counts_and_order(client, add_manual):
    s = _series(client)
    _volume(add_manual, s["id"], 2, status="done", owned=True)
    _volume(add_manual, s["id"], 10)
    _volume(add_manual, s["id"], None, title="Special")
    first = _volume(add_manual, s["id"], 1, owned=True)
    assert first["series_id"] == s["id"]
    assert (first["series_name"], first["series_volume"]) == ("One Piece", 1)

    detail = client.get(f"{URL}/series/{s['id']}").json()
    assert [e["series_volume"] for e in detail["entries"]] == [1, 2, 10, None]
    assert (detail["volumes"], detail["read"], detail["owned"]) == (4, 1, 2)
    assert detail["cover_item"]["title"] == "One Piece 1"
    listed = client.get(f"{URL}/series").json()[0]
    assert (listed["volumes"], listed["read"]) == (4, 1)


def test_mark_a_range_read_and_owned(client, add_manual):
    s = _series(client)
    for n in range(1, 6):
        _volume(add_manual, s["id"], n)
    _volume(add_manual, s["id"], None, title="Unnumbered")
    r = client.post(
        f"{URL}/series/{s['id']}/mark",
        json={"from_volume": 2, "to_volume": 4, "read": True, "owned": True},
    )
    assert r.status_code == 200, r.text
    entries = r.json()["entries"]
    assert [e["status"] for e in entries] == [
        "want",
        "done",
        "done",
        "done",
        "want",
        "want",
    ]
    assert [e["owned"] for e in entries] == [False, True, True, True, False, False]
    vol2 = client.get(f"{URL}/library/{entries[1]['id']}").json()
    assert [s["undated"] for s in vol2["sessions"]] == [True]

    # No range: every volume, unnumbered too; already read ones aren't touched.
    r = client.post(f"{URL}/series/{s['id']}/mark", json={"read": True})
    assert {e["status"] for e in r.json()["entries"]} == {"done"}
    vol2 = client.get(f"{URL}/library/{entries[1]['id']}").json()
    assert len(vol2["sessions"]) == 1

    for body in ({}, {"from_volume": 3, "to_volume": 1, "owned": True}):
        assert client.post(f"{URL}/series/{s['id']}/mark", json=body).status_code == 422


def test_attach_rename_and_delete(client, add_manual):
    s = _series(client)
    book = add_manual(title="Loose")
    e = client.patch(
        f"{URL}/library/{book['id']}", json={"series_id": s["id"], "series_volume": 7}
    ).json()
    assert (e["series_name"], e["series_volume"]) == ("One Piece", 7)

    r = client.patch(f"{URL}/series/{s['id']}", json={"name": "ワンピース"})
    assert r.json()["name"] == "ワンピース"

    assert client.delete(f"{URL}/series/{s['id']}").status_code == 204
    e = client.get(f"{URL}/library/{book['id']}").json()
    assert (e["series_id"], e["series_volume"]) == (None, 7)
    assert client.get(f"{URL}/series/{s['id']}").status_code == 404


def test_series_rules(client, other_client, add_manual):
    mine = _series(client)
    theirs = _series(other_client, "Theirs")
    film = add_manual(type="film")
    r = client.patch(f"{URL}/library/{film['id']}", json={"series_id": mine["id"]})
    assert r.status_code == 422
    r = client.post(
        f"{URL}/library/manual",
        json={"type": "film", "title": "F", "series_id": mine["id"]},
    )
    assert r.status_code == 422
    book = add_manual()
    r = client.patch(f"{URL}/library/{book['id']}", json={"series_id": theirs["id"]})
    assert r.status_code == 404
    r = client.post(
        f"{URL}/library/manual",
        json={"type": "book", "title": "B", "series_id": theirs["id"]},
    )
    assert r.status_code == 404
    for method, path in (
        ("get", ""),
        ("patch", ""),
        ("delete", ""),
        ("post", "/mark"),
    ):
        body = {"name": "x"} if method == "patch" else {"read": True}
        kwargs = {} if method in ("get", "delete") else {"json": body}
        r = getattr(client, method)(f"{URL}/series/{theirs['id']}{path}", **kwargs)
        assert r.status_code == 404, (method, path)
    # The from-search route checks the series before calling the source.
    r = client.post(
        f"{URL}/library/from-search",
        json={
            "source": "openlibrary",
            "external_id": "OL1W",
            "type": "book",
            "series_id": theirs["id"],
        },
    )
    assert r.status_code == 404
