"""Upgrade drafts: `/api/cards/decks/{id}/drafts` and `/api/cards/drafts`."""

import json

import pytest
from sqlalchemy import select

from core import database
from domains.cards import models as m
from tests.cards.conftest import URL, add_catalog_card, make_deck, own, put_in_deck

DECKS = f"{URL}/decks"


@pytest.fixture
def pika():
    return add_catalog_card(
        card_number="25",
        name="Pikachu",
        variants=("standard", "reverse"),
        details={"en": {"attacks": [{"name": "Thunder Shock"}]}},
    )


@pytest.fixture
def rai():
    return add_catalog_card(card_number="26", name="Raichu")


@pytest.fixture
def deck(client, pika, rai):
    """A normal deck holding 2 Pikachu (of 3 owned) and 1 Raichu (of 1)."""
    deck_id = make_deck(client.user_id)
    put_in_deck(deck_id, own(client.user_id, pika, standard=3), 2)
    put_in_deck(deck_id, own(client.user_id, rai, standard=1), 1)
    return deck_id


def new_draft(client, deck_id, **body) -> dict:
    response = client.post(f"{DECKS}/{deck_id}/drafts", json={"name": "Up", **body})
    assert response.status_code == 201, response.text
    return response.json()


def set_entry(client, deck_id, draft_id, catalog_id, delta, variant="standard"):
    return client.put(
        f"{DECKS}/{deck_id}/drafts/{draft_id}/entries/{catalog_id}",
        params={"variant_type": variant},
        json={"quantity_delta": delta},
    )


def deck_quantities(deck_id) -> dict[tuple[int, str], int]:
    with database.SessionLocal() as session:
        rows = session.execute(
            select(
                m.Card.catalog_id, m.DeckCard.variant_type, m.DeckCard.quantity_in_deck
            )
            .join(m.Card, m.Card.id == m.DeckCard.card_id)
            .where(m.DeckCard.deck_id == deck_id)
        )
        return {(cid, variant): q for cid, variant, q in rows}


def test_drafts_are_for_the_owners_normal_decks(client, other_client, deck):
    phantom = make_deck(client.user_id, "Wants", "phantom")
    assert client.get(f"{DECKS}/{phantom}/drafts").status_code == 422
    body = {"name": "Up"}
    assert client.post(f"{DECKS}/{phantom}/drafts", json=body).status_code == 422
    draft = new_draft(client, deck)
    assert other_client.get(f"{DECKS}/{deck}/drafts").status_code == 404
    other_deck = make_deck(other_client.user_id)
    assert (
        other_client.get(f"{DECKS}/{other_deck}/drafts/{draft['id']}").status_code
        == 404
    )


def test_create_rename_delete(client, deck):
    draft = new_draft(client, deck, name="  Budget  ")
    assert draft["name"] == "Budget" and draft["entries"] == []
    assert draft["result_total"] == 3 and draft["can_apply"] is False
    assert len(draft["current_cards"]) == 2
    url = f"{DECKS}/{deck}/drafts"
    assert client.post(url, json={"name": "Budget"}).status_code == 409
    assert client.post(url, json={"name": " "}).status_code == 422
    other = new_draft(client, deck, name="Meta")
    assert (
        client.put(f"{url}/{other['id']}", json={"name": "Budget"}).status_code == 409
    )
    renamed = client.put(f"{url}/{other['id']}", json={"name": "Meta 2"})
    assert renamed.status_code == 200 and renamed.json()["entry_count"] == 0
    assert [d["name"] for d in client.get(url).json()] == ["Meta 2", "Budget"]
    assert client.delete(f"{url}/{other['id']}").status_code == 204
    assert [d["name"] for d in client.get(url).json()] == ["Budget"]


def test_lines_and_their_range(client, deck, pika, rai):
    draft = new_draft(client, deck)["id"]
    response = set_entry(client, deck, draft, rai, 3)
    assert response.status_code == 200, response.text
    detail = response.json()
    line = detail["entries"][0]
    assert (line["baseline_quantity"], line["quantity_delta"]) == (1, 3)
    assert line["result_quantity"] == 4
    # 1 owned, in the deck already: nothing available.
    assert (line["owned"], line["available"]) == (1, 0)
    assert detail["result_total"] == 6 and detail["can_apply"] is False

    assert set_entry(client, deck, draft, rai, 4).status_code == 409  # 5 > 4
    assert set_entry(client, deck, draft, pika, -3).status_code == 409  # below 0
    assert set_entry(client, deck, draft, pika, 0).status_code == 422
    assert (
        set_entry(client, deck, draft, pika, 1, "reverse_masterball").status_code == 422
    )
    assert set_entry(client, deck, draft, 999999, 1).status_code == 404
    # Another print is its own line, from 0.
    assert set_entry(client, deck, draft, pika, 2, "reverse").status_code == 200

    url = f"{DECKS}/{deck}/drafts/{draft}/entries/{rai}"
    assert client.delete(url).status_code == 200
    assert client.delete(url).status_code == 404
    lines = client.get(f"{DECKS}/{deck}/drafts/{draft}").json()["entries"]
    assert [(e["catalog_id"], e["variant_type"]) for e in lines] == [(pika, "reverse")]


def test_paste_diffs_against_the_standard_prints(client, deck, pika, rai):
    ditto = add_catalog_card(card_number="132", name="Ditto")
    draft = new_draft(client, deck, decklist_text="4 Pikachu SVI 25\n2 Ditto SVI 132")
    lines = {e["catalog_id"]: e["quantity_delta"] for e in draft["entries"]}
    assert lines == {pika: 2, ditto: 2, rai: -1}
    result = {(c["catalog_id"], c["quantity_in_deck"]) for c in draft["result_cards"]}
    assert result == {(pika, 4), (ditto, 2)}
    assert draft["result_total"] == 6

    # A deck file's JSON works too; pasting replaces the lines.
    file = {
        "name": "x",
        "cards": [{"set_code": "SVI", "card_number": "26", "quantity_in_deck": 1}],
    }
    response = client.put(
        f"{DECKS}/{deck}/drafts/{draft['id']}/paste",
        json={"decklist_text": json.dumps(file)},
    )
    assert {
        e["catalog_id"]: e["quantity_delta"] for e in response.json()["entries"]
    } == {pika: -2}
    url = f"{DECKS}/{deck}/drafts/{draft['id']}/paste"
    assert client.put(url, json={"decklist_text": "nothing here"}).status_code == 422
    too_many = {"decklist_text": "5 Pikachu SVI 25"}
    assert client.put(url, json=too_many).status_code == 409


def test_apply_writes_the_deck_and_consumes_the_draft(client, deck, pika, rai):
    draft = new_draft(client, deck)["id"]
    set_entry(client, deck, draft, pika, -1)
    set_entry(client, deck, draft, rai, -1)
    response = client.post(f"{DECKS}/{deck}/drafts/{draft}/apply")
    assert response.status_code == 200, response.text
    assert response.json()["total_cards"] == 1
    assert deck_quantities(deck) == {(pika, "standard"): 1}
    assert client.get(f"{DECKS}/{deck}/drafts/{draft}").status_code == 404
    with database.SessionLocal() as session:
        actions = session.scalars(
            select(m.DeckHistory.action)
            .where(m.DeckHistory.deck_id == deck)
            .order_by(m.DeckHistory.id)
        ).all()
    assert actions == ["card_quantity_changed", "card_removed"]


def test_apply_keeps_the_binder_copy_and_rechecks(client, deck, pika):
    draft = new_draft(client, deck)["id"]
    # 3 owned, 2 in the deck: the third stays in the binder.
    detail = set_entry(client, deck, draft, pika, 1).json()
    assert detail["entries"][0]["available"] == 0
    assert detail["can_apply"] is False
    url = f"{DECKS}/{deck}/drafts/{draft}/apply"
    response = client.post(url)
    assert response.status_code == 409 and "Pikachu" in response.json()["detail"]
    assert deck_quantities(deck)[(pika, "standard")] == 2

    client.post(f"{URL}/collection", json={"catalog_id": pika})
    assert client.get(f"{DECKS}/{deck}/drafts/{draft}").json()["can_apply"] is True
    assert client.post(url).status_code == 200
    assert deck_quantities(deck)[(pika, "standard")] == 3

    # Out of date: the deck no longer has what a removal takes away.
    stale = new_draft(client, deck, name="Stale")["id"]
    set_entry(client, deck, stale, pika, -3)
    rows = client.get(f"{DECKS}/{deck}").json()["cards"]
    pika_row = next(c for c in rows if c["catalog_id"] == pika)
    client.put(f"{DECKS}/{deck}/cards/{pika_row['id']}", json={"quantity_in_deck": 1})
    response = client.post(f"{DECKS}/{deck}/drafts/{stale}/apply")
    assert response.status_code == 409 and "out of date" in response.json()["detail"]
    empty = new_draft(client, deck, name="Empty")["id"]
    assert client.post(f"{DECKS}/{deck}/drafts/{empty}/apply").status_code == 409


def test_draft_text_export_modes(client, deck, pika, rai):
    ditto = add_catalog_card(card_number="132", name="Ditto")
    own(client.user_id, ditto, standard=2)
    draft = new_draft(client, deck)["id"]
    set_entry(client, deck, draft, pika, 2)  # 3 owned, 1 outside the deck
    set_entry(client, deck, draft, ditto, 2)  # 2 owned, both free
    set_entry(client, deck, draft, rai, -1)  # never exported

    def export(mode, **params):
        response = client.get(
            f"{DECKS}/{deck}/drafts/{draft}/export/text",
            params={"format": "tcgplayer", "mode": mode, **params},
        )
        assert response.status_code == 200, response.text
        return response.text

    assert export("full") == "Pokémon (4)\n2 Pikachu SVI 25\n2 Ditto SVI 132"
    assert export("missing") == ""
    assert export("not_available") == "Pokémon (1)\n1 Pikachu SVI 25"
    assert export("reserve_singles") == "Pokémon (3)\n2 Pikachu SVI 25\n1 Ditto SVI 132"
    cardmarket = client.get(
        f"{DECKS}/{deck}/drafts/{draft}/export/text",
        params={"format": "cardmarket", "mode": "full", "include_sets": False},
    )
    assert cardmarket.text == "2x Pikachu [Thunder Shock]\n2x Ditto"


def test_combined_drafts_pool_their_demand(client, other_client, deck, pika):
    with database.SessionLocal() as session:
        session.get(m.CardCatalog, pika).display_name = "Pikachu FR"
        session.commit()
    other_deck = make_deck(client.user_id, "Other")
    first = new_draft(client, deck)["id"]
    second = new_draft(client, other_deck, name="Second")["id"]
    set_entry(client, deck, first, pika, 1)
    set_entry(client, other_deck, second, pika, 1)

    picker = client.get(f"{URL}/drafts").json()
    assert {(d["deck_name"], d["name"], d["result_total"]) for d in picker} == {
        ("Deck", "Up", 4),
        ("Other", "Second", 1),
    }

    def export(ids, mode, **params):
        return client.post(
            f"{URL}/drafts/export/text",
            params={"format": "cardmarket", "mode": mode, **params},
            json={"draft_ids": ids},
        )

    # 1 copy outside decks covers one draft alone, not both together.
    assert export([first], "not_available").text == ""
    assert export([first, second], "not_available").text == (
        "1x Pikachu [Thunder Shock] (Scarlet & Violet)"
    )
    assert export([first, second], "full", language="fr").text == (
        "2x Pikachu FR [Thunder Shock] (Scarlet & Violet)"
    )
    other_draft = new_draft(other_client, make_deck(other_client.user_id))["id"]
    assert export([first, other_draft], "full").status_code == 404
    assert export([], "full").status_code == 422
    assert export([first], "everything").status_code == 422
