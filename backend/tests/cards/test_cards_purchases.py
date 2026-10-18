"""What I Paid: `/api/cards/purchases`."""

from tests.cards.conftest import URL

PURCHASES = f"{URL}/purchases"


def add(client, **body):
    return client.post(
        PURCHASES,
        json={
            "product_name": "Booster box",
            "price": "120.50",
            "purchased_at": "2026-09-01",
        }
        | body,
    )


def test_needs_the_cards_app(anon, cards_client):
    assert anon.get(PURCHASES).status_code == 401
    no_access = cards_client("nope@example.com", apps=("media",))
    assert no_access.get(PURCHASES).status_code == 403


def test_create_with_defaults_and_cleaning(client):
    response = client.post(
        PURCHASES,
        json={
            "product_name": "  ETB ",
            "price": 0,
            "source": "  ",
            "description": " mint ",
            "sets": [" SVI", "MEW", "SVI", ""],
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["product_name"] == "ETB"
    assert body["price"] == "0.00"
    assert body["quantity"] == 1
    assert body["purchased_at"].endswith("T00:00:00Z")
    assert body["source"] is None
    assert body["description"] == "mint"
    assert body["sets"] == ["SVI", "MEW"]


def test_validation(client):
    assert add(client, product_name=" ").status_code == 422
    assert add(client, price="-1").status_code == 422
    assert add(client, price="1.234").status_code == 422
    assert add(client, quantity=0).status_code == 422
    assert client.get(PURCHASES).json() == []


def test_list_is_private_and_newest_first(client, other_client):
    old = add(client, purchased_at="2026-01-01").json()
    new = add(client, purchased_at="2026-06-01T15:00:00+00:00").json()
    add(other_client)
    listed = client.get(PURCHASES).json()
    assert [p["id"] for p in listed] == [new["id"], old["id"]]
    assert listed[0]["purchased_at"] == "2026-06-01T00:00:00Z"


def test_update_and_delete_own_rows_only(client, other_client):
    purchase = add(client).json()
    body = {
        "product_name": "Bundle",
        "price": "10",
        "quantity": 2,
        "purchased_at": "2026-02-02",
        "sets": ["PAL"],
    }
    url = f"{PURCHASES}/{purchase['id']}"
    assert other_client.put(url, json=body).status_code == 404
    assert other_client.delete(url).status_code == 404
    response = client.put(url, json=body)
    assert response.status_code == 200
    assert response.json() | {"id": 0, "created_at": ""} == {
        "id": 0,
        "product_name": "Bundle",
        "price": "10.00",
        "quantity": 2,
        "purchased_at": "2026-02-02T00:00:00Z",
        "source": None,
        "description": None,
        "sets": ["PAL"],
        "created_at": "",
    }
    # A full update: the date is required.
    assert client.put(url, json=body | {"purchased_at": None}).status_code == 422
    assert client.delete(url).status_code == 204
    assert client.get(PURCHASES).json() == []


def test_delete_all_is_per_user(client, other_client):
    add(client)
    add(client)
    add(other_client)
    assert client.delete(PURCHASES).json() == {"deleted_purchases": 2}
    assert client.get(PURCHASES).json() == []
    assert len(other_client.get(PURCHASES).json()) == 1


def test_export_import_round_trip(client, other_client):
    add(client, source="Vinted", sets=["SVI"])
    exported = client.get(f"{PURCHASES}/export").json()
    assert exported == {
        "purchases": [
            {
                "product_name": "Booster box",
                "price": "120.50",
                "quantity": 1,
                "purchased_at": "2026-09-01T00:00:00Z",
                "source": "Vinted",
                "description": None,
                "sets": ["SVI"],
            }
        ]
    }
    response = other_client.post(f"{PURCHASES}/import-all", json=exported)
    assert response.status_code == 201
    assert response.json()[0]["source"] == "Vinted"
    assert len(other_client.get(PURCHASES).json()) == 1


def test_import_an_old_file(client):
    old = {
        "purchases": [
            {
                "product_name": "Lot",
                "price": 12.5,
                "quantity": 3,
                "purchased_at": "2025-05-05T13:14:15.123456+00:00",
                "source": None,
                "description": None,
                "sets": [],
            }
        ]
    }
    [purchase] = client.post(f"{PURCHASES}/import-all", json=old).json()
    assert purchase["price"] == "12.50"
    assert purchase["purchased_at"] == "2025-05-05T00:00:00Z"


def test_import_is_all_or_nothing(client):
    good = {
        "product_name": "A",
        "price": 1,
        "quantity": 1,
        "purchased_at": "2026-01-01",
    }
    for bad in (
        good | {"price": -1},
        good | {"quantity": 0},
        good | {"product_name": ""},
        good | {"purchased_at": "later"},
        {k: v for k, v in good.items() if k != "purchased_at"},
    ):
        response = client.post(
            f"{PURCHASES}/import-all", json={"purchases": [good, bad]}
        )
        assert response.status_code == 422
    assert (
        client.post(f"{PURCHASES}/import-all", json={"purchases": []}).status_code
        == 422
    )
    assert client.get(PURCHASES).json() == []
