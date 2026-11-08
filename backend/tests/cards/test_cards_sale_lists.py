"""Sale lists: `/api/cards/sale-lists`, and the copies they reserve."""

import pytest
from sqlalchemy import select

from core import database
from domains.cards import models as m
from tests.cards.conftest import URL, add_catalog_card, make_deck, own, put_in_deck

LISTS = f"{URL}/sale-lists"
COLLECTION = f"{URL}/collection"
DECKS = f"{URL}/decks"


@pytest.fixture
def pika():
    return add_catalog_card(card_number="25", name="Pikachu")


@pytest.fixture
def rai():
    return add_catalog_card(card_number="26", name="Raichu")


def create(client, name="Batch 1"):
    response = client.post(LISTS, json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def add(client, list_id, catalog_id, quantity=1, variant="standard"):
    return client.post(
        f"{LISTS}/{list_id}/cards",
        json={"catalog_id": catalog_id, "variant_type": variant, "quantity": quantity},
    )


def lines(detail) -> dict[tuple[int, str], int]:
    return {
        (c["catalog_id"], c["variant_type"]): c["quantity"] for c in detail["cards"]
    }


def owned(user_id, catalog_id) -> dict[str, int]:
    with database.SessionLocal() as session:
        card = session.scalar(
            select(m.Card).where(
                m.Card.user_id == user_id, m.Card.catalog_id == catalog_id
            )
        )
        if card is None:
            return {}
        return {vq.variant_type: vq.quantity for vq in card.variant_quantities}


def test_needs_the_cards_app(anon, cards_client):
    assert anon.get(LISTS).status_code == 401
    no_access = cards_client("nope@example.com", apps=("media",))
    assert no_access.get(LISTS).status_code == 403


def test_create_rename_list_and_delete(client, other_client):
    first = create(client)
    assert first["cards"] == [] and first["sold_at"] is None
    assert client.post(LISTS, json={"name": " Batch 1 "}).status_code == 409
    assert client.post(LISTS, json={"name": "  "}).status_code == 422
    second = create(client, "Batch 2")
    assert [row["name"] for row in client.get(LISTS).json()] == ["Batch 2", "Batch 1"]
    assert (
        client.put(f"{LISTS}/{first['id']}", json={"name": "Batch 2"}).status_code
        == 409
    )
    renamed = client.put(f"{LISTS}/{first['id']}", json={"name": "Vinted"})
    assert renamed.json()["name"] == "Vinted"
    assert other_client.get(f"{LISTS}/{first['id']}").status_code == 404
    assert client.delete(f"{LISTS}/{second['id']}").status_code == 204
    assert [row["name"] for row in client.get(LISTS).json()] == ["Vinted"]


def test_add_is_capped_at_sellable_copies(client, pika, rai):
    card = own(client.user_id, pika, standard=3, reverse=1)
    put_in_deck(make_deck(client.user_id), card, 1)
    first, second = create(client), create(client, "Batch 2")
    # 3 owned − 1 in a deck = 2 sellable.
    assert add(client, first["id"], pika, 3).status_code == 409
    detail = add(client, first["id"], pika, 1).json()
    detail = add(client, first["id"], pika, 1).json()
    assert lines(detail) == {(pika, "standard"): 2}
    # Another list can't sell the same copies.
    assert add(client, second["id"], pika, 1).status_code == 409
    assert add(client, second["id"], pika, 1, "reverse").status_code == 201
    # Not owned at all.
    assert add(client, second["id"], rai, 1).status_code == 409
    assert add(client, second["id"], 999_999, 1).status_code == 404
    assert client.get(f"{LISTS}/on-sale").json() == [
        {"catalog_id": pika, "variant_type": "reverse", "quantity": 1},
        {"catalog_id": pika, "variant_type": "standard", "quantity": 2},
    ]
    summary = {row["name"]: row for row in client.get(LISTS).json()}
    assert summary["Batch 1"]["total_cards"] == 1
    assert summary["Batch 1"]["total_quantity"] == 2


def test_edit_lines(client, pika):
    own(client.user_id, pika, standard=2, reverse=2)
    sale = create(client)
    row = add(client, sale["id"], pika, 1).json()["cards"][0]
    url = f"{LISTS}/{sale['id']}/cards/{row['id']}"
    assert (
        client.put(url, json={"variant_type": "standard", "quantity": 3}).status_code
        == 409
    )
    raised = client.put(url, json={"variant_type": "standard", "quantity": 2})
    assert lines(raised.json()) == {(pika, "standard"): 2}
    add(client, sale["id"], pika, 1, "reverse")
    # Moved onto the reverse line: 1 + 2 > 2 reverses.
    assert (
        client.put(url, json={"variant_type": "reverse", "quantity": 2}).status_code
        == 409
    )
    merged = client.put(url, json={"variant_type": "reverse", "quantity": 1})
    assert lines(merged.json()) == {(pika, "reverse"): 2}
    reverse_row = merged.json()["cards"][0]["id"]
    assert client.delete(f"{LISTS}/{sale['id']}/cards/{reverse_row}").status_code == 204
    assert client.get(f"{LISTS}/{sale['id']}").json()["cards"] == []


def test_mark_sold_takes_the_cards_off_the_collection(client, pika, rai):
    own(client.user_id, pika, standard=2, reverse=1)
    own(client.user_id, rai, standard=1)
    sale = create(client)
    add(client, sale["id"], pika, 1)
    add(client, sale["id"], pika, 1, "reverse")
    add(client, sale["id"], rai, 1)
    response = client.post(f"{LISTS}/{sale['id']}/sell")
    assert response.status_code == 200, response.text
    assert response.json()["sold_at"] is not None
    assert owned(client.user_id, pika) == {"standard": 1}
    assert owned(client.user_id, rai) == {}
    with database.SessionLocal() as session:
        sources = session.scalars(
            select(m.CollectionHistory.source).where(
                m.CollectionHistory.user_id == client.user_id
            )
        ).all()
    assert sources == ["sale"] * 3
    # Read-only once sold, and no longer reserving copies.
    assert client.post(f"{LISTS}/{sale['id']}/sell").status_code == 409
    assert add(client, sale["id"], pika, 1).status_code == 409
    assert client.get(f"{LISTS}/on-sale").json() == []
    other = create(client, "Batch 2")
    assert add(client, other["id"], pika, 1).status_code == 201
    assert [row["name"] for row in client.get(LISTS).json()] == ["Batch 2", "Batch 1"]


def test_copies_on_sale_are_reserved(client, pika):
    card = own(client.user_id, pika, standard=2)
    sale = create(client)
    add(client, sale["id"], pika, 1)
    put = client.put(
        f"{COLLECTION}/{card}", json={"variant_type": "standard", "quantity": 0}
    )
    assert put.status_code == 409
    assert client.delete(f"{COLLECTION}/{card}").status_code == 409
    deck = make_deck(client.user_id)
    url = f"{DECKS}/{deck}/cards"
    assert (
        client.post(url, json={"card_id": card, "quantity_in_deck": 2}).status_code
        == 409
    )
    assert (
        client.post(url, json={"card_id": card, "quantity_in_deck": 1}).status_code
        == 201
    )
    lowered = client.put(
        f"{COLLECTION}/{card}", json={"variant_type": "standard", "quantity": 1}
    )
    assert lowered.status_code == 409


def test_delete_all_drops_unsold_lists(client, pika, rai):
    own(client.user_id, pika, standard=1)
    own(client.user_id, rai, standard=1)
    sold, open_ = create(client), create(client, "Batch 2")
    add(client, sold["id"], pika, 1)
    client.post(f"{LISTS}/{sold['id']}/sell")
    add(client, open_["id"], rai, 1)
    assert client.delete(COLLECTION).status_code == 200
    assert [row["name"] for row in client.get(LISTS).json()] == ["Batch 1"]


def test_bulk_add_is_all_or_nothing(client, pika, rai):
    own(client.user_id, pika, standard=2, reverse=1)
    own(client.user_id, rai, standard=1)
    sale = create(client)
    url = f"{LISTS}/{sale['id']}/cards/bulk"
    # The two standard Pikachu lines add up to 3 > 2 owned.
    too_many = client.post(
        url,
        json={
            "items": [
                {"catalog_id": pika, "quantity": 2},
                {"catalog_id": rai, "quantity": 1},
                {"catalog_id": pika, "quantity": 1},
            ]
        },
    )
    assert too_many.status_code == 409
    assert client.get(f"{LISTS}/{sale['id']}").json()["cards"] == []
    assert client.post(url, json={"items": []}).status_code == 422
    unknown = client.post(url, json={"items": [{"catalog_id": 999_999}]})
    assert unknown.status_code == 404
    added = client.post(
        url,
        json={
            "items": [
                {"catalog_id": pika, "quantity": 1},
                {"catalog_id": pika, "variant_type": "reverse"},
                {"catalog_id": rai},
                {"catalog_id": pika, "quantity": 1},
            ]
        },
    )
    assert added.status_code == 201, added.text
    assert lines(added.json()) == {
        (pika, "standard"): 2,
        (pika, "reverse"): 1,
        (rai, "standard"): 1,
    }
