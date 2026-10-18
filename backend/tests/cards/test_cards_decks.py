"""`/api/cards/decks`: normal and phantom decks, their cards and limits,
posters, history, copy, delete, export/import."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select

from core import database
from domains.cards import models as m
from tests.cards.conftest import (
    URL,
    add_catalog_card,
    make_deck,
    own,
    put_in_deck,
    set_language,
)

DECKS = f"{URL}/decks"


def deck_log(deck_id: int) -> list[tuple]:
    """(action, detail, old, new, print), oldest first."""
    with database.SessionLocal() as session:
        rows = session.scalars(
            select(m.DeckHistory)
            .where(m.DeckHistory.deck_id == deck_id)
            .order_by(m.DeckHistory.id)
        )
        return [
            (h.action, h.detail, h.old_value, h.new_value, h.variant_type) for h in rows
        ]


def deck_count() -> int:
    with database.SessionLocal() as session:
        return session.scalar(select(func.count()).select_from(m.Deck))


def create(client, name="Deck", **body):
    response = client.post(DECKS, json={"name": name, **body})
    assert response.status_code == 201, response.text
    return response.json()


def cards_of(client, deck_id) -> dict[tuple[int, str], dict]:
    response = client.get(f"{DECKS}/{deck_id}")
    assert response.status_code == 200, response.text
    return {(c["catalog_id"], c["variant_type"]): c for c in response.json()["cards"]}


@pytest.fixture
def pika():
    return add_catalog_card(
        card_number="25",
        name="Pikachu",
        variants=("standard", "reverse"),
    )


@pytest.fixture
def rai():
    return add_catalog_card(card_number="26", name="Raichu", supertype="Pokémon")


@pytest.fixture
def energy():
    return add_catalog_card(
        card_number="257",
        name="Lightning Energy",
        supertype="Energy",
        variants=("standard",),
    )


# ── access ───────────────────────────────────────────────────────────────────


def test_decks_need_the_cards_app(anon, cards_client):
    assert anon.get(DECKS).status_code == 401
    no_access = cards_client("nope@example.com", apps=("media",))
    for path in (DECKS, f"{URL}/drafts", f"{DECKS}/export"):
        assert no_access.get(path).status_code == 403
    assert (
        no_access.post(f"{URL}/convert/decklist", json={"text": "x"}).status_code == 403
    )


def test_other_users_decks_are_hidden(client, other_client, pika):
    theirs = make_deck(other_client.user_id, "Theirs")
    card = own(other_client.user_id, pika)
    put_in_deck(theirs, card, 1)
    assert client.get(DECKS).json() == []
    for path in ("", "/history", "/export", "/export/text?format=tcgplayer"):
        assert client.get(f"{DECKS}/{theirs}{path}").status_code == 404, path
    assert client.put(f"{DECKS}/{theirs}", json={"name": "Mine"}).status_code == 404
    assert client.delete(f"{DECKS}/{theirs}").status_code == 404
    assert client.post(f"{DECKS}/{theirs}/copy", json={"name": "X"}).status_code == 404
    # Nor can their card go into my deck.
    mine = make_deck(client.user_id, "Mine")
    body = {"card_id": card, "quantity_in_deck": 1}
    assert client.post(f"{DECKS}/{mine}/cards", json=body).status_code == 404
    assert deck_count() == 2


# ── create, list ─────────────────────────────────────────────────────────────


def test_create_and_list(client, other_client):
    deck = create(client, "  Zoroark  ", description="  Fast  ")
    assert deck["name"] == "Zoroark" and deck["description"] == "Fast"
    assert deck["deck_type"] == "normal"
    assert deck["total_cards"] == 0 and deck["poster_cards"] == []
    create(client, "Arceus", deck_type="phantom")
    create(other_client, "Zoroark")  # names are unique per owner
    assert [d["name"] for d in client.get(DECKS).json()] == ["Arceus", "Zoroark"]
    assert deck_log(deck["id"]) == [("created", "Zoroark", None, None, None)]

    assert client.post(DECKS, json={"name": "Zoroark"}).status_code == 409
    assert client.post(DECKS, json={"name": "  "}).status_code == 422
    body = {"name": "X", "deck_type": "wdc"}
    assert client.post(DECKS, json=body).status_code == 422


def test_create_from_a_pasted_decklist(client, pika, rai):
    own(client.user_id, pika, standard=3)
    text = "Pokémon (3)\n2 Pikachu SVI 25\n1 Unknown Thing SVI 999\n"
    deck = create(client, "Pasted", decklist_text=text)
    assert deck["total_cards"] == 2
    assert {
        k: c["quantity_in_deck"] for k, c in cards_of(client, deck["id"]).items()
    } == {(pika, "standard"): 2}

    # Normal: every matched card must be owned, under the limits; nothing is
    # created otherwise.
    response = client.post(
        DECKS, json={"name": "No", "decklist_text": "1 Raichu SVI 26"}
    )
    assert response.status_code == 409 and "Raichu" in response.json()["detail"]
    response = client.post(
        DECKS, json={"name": "No", "decklist_text": "2 Pikachu SVI 25"}
    )
    assert response.status_code == 409  # only 1 standard copy left
    assert deck_count() == 1

    # Phantom: anything matched goes in, owned or not.
    phantom = create(
        client,
        "Wants",
        deck_type="phantom",
        decklist_text="4x Raichu (SVI)\n6x Pikachu (SVI)",
    )
    assert phantom["total_cards"] == 10


# ── normal deck cards ────────────────────────────────────────────────────────


def test_add_change_and_remove_a_card(client, pika):
    card = own(client.user_id, pika, standard=3, reverse=1)
    deck = make_deck(client.user_id)
    url = f"{DECKS}/{deck}/cards"
    response = client.post(url, json={"card_id": card, "quantity_in_deck": 2})
    assert response.status_code == 201, response.text
    row = response.json()
    assert row["catalog_id"] == pika and row["name"] == "Pikachu"
    assert row["available"] == 1 and row["owned"] is None
    again = client.post(url, json={"card_id": card, "quantity_in_deck": 1})
    assert again.status_code == 409
    reverse = client.post(
        url, json={"card_id": card, "variant_type": "reverse", "quantity_in_deck": 1}
    ).json()

    changed = client.put(f"{url}/{row['id']}", json={"quantity_in_deck": 3})
    assert changed.status_code == 200 and changed.json()["available"] == 0
    assert (
        client.put(f"{url}/{row['id']}", json={"quantity_in_deck": 4}).status_code
        == 409
    )
    assert (
        client.put(f"{url}/{row['id']}", json={"quantity_in_deck": 0}).status_code
        == 422
    )
    assert client.delete(f"{url}/{reverse['id']}").status_code == 204
    assert client.delete(f"{url}/{reverse['id']}").status_code == 404
    assert deck_log(deck) == [
        ("card_added", "Pikachu", None, "2", "standard"),
        ("card_added", "Pikachu", None, "1", "reverse"),
        ("card_quantity_changed", "Pikachu", "2", "3", "standard"),
        ("card_removed", "Pikachu", "1", None, "reverse"),
    ]


def test_add_checks_its_input(client, other_client, pika):
    card = own(client.user_id, pika)
    deck = make_deck(client.user_id)
    url = f"{DECKS}/{deck}/cards"
    for body in (
        {"catalog_id": pika, "quantity_in_deck": 1},
        {"card_id": card, "catalog_id": pika, "quantity_in_deck": 1},
        {"card_id": card, "variant_type": "reverse_pokeball", "quantity_in_deck": 1},
        {"card_id": card, "quantity_in_deck": 0},
    ):
        assert client.post(url, json=body).status_code == 422, body
    assert client.post(url, json={"card_id": 999999}).status_code == 404


def test_normal_deck_limits(client, pika, energy):
    pika_card = own(client.user_id, pika, standard=5, reverse=2)
    energy_card = own(client.user_id, energy, standard=70)
    deck = make_deck(client.user_id)
    url = f"{DECKS}/{deck}/cards"

    def add(card, copies, variant="standard"):
        return client.post(
            url,
            json={"card_id": card, "variant_type": variant, "quantity_in_deck": copies},
        )

    # 4 copies per card, over every print.
    assert add(pika_card, 3).status_code == 201
    response = add(pika_card, 2, "reverse")
    assert response.status_code == 409 and "Pikachu" in response.json()["detail"]
    assert add(pika_card, 1, "reverse").status_code == 201
    # Basic Energy has no copy limit, but the deck stops at 60.
    assert add(energy_card, 57).status_code == 409
    energy_row = add(energy_card, 56).json()
    assert (
        client.put(
            f"{url}/{energy_row['id']}", json={"quantity_in_deck": 57}
        ).status_code
        == 409
    )

    # Copies are shared between decks, per print.
    other = make_deck(client.user_id, "Other")
    response = client.post(
        f"{DECKS}/{other}/cards", json={"card_id": pika_card, "quantity_in_deck": 3}
    )
    assert response.status_code == 409 and "Only 2" in response.json()["detail"]
    assert (
        client.post(
            f"{DECKS}/{other}/cards", json={"card_id": pika_card, "quantity_in_deck": 2}
        ).status_code
        == 201
    )


def test_bulk_add_and_paste_into_a_deck(client, pika, rai):
    pika_card = own(client.user_id, pika, standard=2, reverse=2)
    rai_card = own(client.user_id, rai, standard=4)
    deck = make_deck(client.user_id)
    response = client.post(
        f"{DECKS}/{deck}/cards/bulk",
        json={
            "items": [
                {"card_id": pika_card, "all_variants": True},
                {"card_id": rai_card, "quantity_in_deck": 1},
                {"card_id": rai_card, "quantity_in_deck": 1},
            ]
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["total_cards"] == 4
    assert {k: c["quantity_in_deck"] for k, c in cards_of(client, deck).items()} == {
        (pika, "standard"): 1,
        (pika, "reverse"): 1,
        (rai, "standard"): 2,
    }
    # A paste adds on top, standard print.
    response = client.post(
        f"{DECKS}/{deck}/cards/from-paste", json={"decklist_text": "2 Raichu SVI 26"}
    )
    assert response.status_code == 201
    assert cards_of(client, deck)[(rai, "standard")]["quantity_in_deck"] == 4
    response = client.post(
        f"{DECKS}/{deck}/cards/from-paste", json={"decklist_text": "1 Raichu SVI 26"}
    )
    assert response.status_code == 409
    response = client.post(
        f"{DECKS}/{deck}/cards/from-paste", json={"decklist_text": "hello"}
    )
    assert response.status_code == 422

    bulk = {"items": [{"card_id": pika_card, "quantity_in_deck": 5}]}
    assert client.post(f"{DECKS}/{deck}/cards/bulk", json=bulk).status_code == 409
    phantom = make_deck(client.user_id, "Wants", "phantom")
    assert client.post(f"{DECKS}/{phantom}/cards/bulk", json=bulk).status_code == 422


# ── phantom decks ────────────────────────────────────────────────────────────


def test_phantom_rows_show_owned_and_available(client, pika, rai):
    pika_card = own(client.user_id, pika, standard=3, reverse=1)
    normal = make_deck(client.user_id, "Real")
    put_in_deck(normal, pika_card, 2)
    deck = make_deck(client.user_id, "Wants", "phantom")
    url = f"{DECKS}/{deck}/cards"
    # No limits: 10 copies of a card owned 3 times.
    assert (
        client.post(url, json={"catalog_id": pika, "quantity_in_deck": 10}).status_code
        == 201
    )
    assert client.post(url, json={"catalog_id": rai}).status_code == 201
    assert client.post(url, json={"card_id": pika_card}).status_code == 422
    assert client.post(url, json={"catalog_id": pika}).status_code == 409

    rows = cards_of(client, deck)
    wanted = rows[(pika, "standard")]
    assert wanted["card_id"] is None and wanted["quantity_in_deck"] == 10
    # Per print: 3 standard owned, 2 of them in the normal deck.
    assert (wanted["owned"], wanted["available"]) == (3, 1)
    assert wanted["allocated_decks"] == [
        {"deck_id": normal, "deck_name": "Real", "quantity_in_deck": 2}
    ]
    assert rows[(rai, "standard")]["owned"] == 0
    assert rows[(rai, "standard")]["available"] == 0

    row_id = rows[(pika, "standard")]["id"]
    assert (
        client.put(f"{url}/{row_id}", json={"quantity_in_deck": 40}).status_code == 200
    )
    assert client.get(f"{DECKS}/{deck}").json()["total_cards"] == 41
    # A wanted card doesn't hold back its owned copies.
    assert (
        client.delete(f"{URL}/collection/{own(client.user_id, rai)}").status_code == 204
    )


def test_wdc_tag_follows_the_cards(client, pika):
    wdc = add_catalog_card(
        set_code="WC25", card_number="1", name="Pikachu", series="World Championships"
    )
    wdc_card = own(client.user_id, wdc)
    own(client.user_id, pika)
    deck = make_deck(client.user_id)
    row = client.post(
        f"{DECKS}/{deck}/cards", json={"card_id": wdc_card, "quantity_in_deck": 1}
    ).json()
    assert client.get(DECKS).json()[0]["has_wdc_cards"] is True
    client.delete(f"{DECKS}/{deck}/cards/{row['id']}")
    assert client.get(DECKS).json()[0]["has_wdc_cards"] is False

    phantom = create(
        client, "Wants", deck_type="phantom", decklist_text="1 Pikachu WC25 1"
    )
    assert phantom["has_wdc_cards"] is True


def test_display_fields_follow_the_language(client):
    zap = add_catalog_card(
        card_number="145",
        name="Zapdos",
        display_name="Électhor",
        image_path_fr="Scarlet & Violet/SVI/cards/145_zapdos_standard_FR.jpg",
    )
    set_language(client.user_id, "fr")
    deck = create(
        client, "Wants", deck_type="phantom", decklist_text="1 Zapdos SVI 145"
    )["id"]
    row = cards_of(client, deck)[(zap, "standard")]
    assert row["name"] == "Électhor"
    assert row["image_path"].endswith("_FR.jpg")
    # History and exports stay English.
    assert deck_log(deck)[1][1] == "Zapdos"
    assert client.get(f"{DECKS}/{deck}/export").json()["cards"][0]["name"] == "Zapdos"
    set_language(client.user_id, "en")
    assert cards_of(client, deck)[(zap, "standard")]["name"] == "Zapdos"


# ── edit, posters ────────────────────────────────────────────────────────────


def test_rename_and_describe(client):
    deck = create(client, "Old", description="Notes")["id"]
    create(client, "Taken")
    url = f"{DECKS}/{deck}"
    assert client.put(url, json={"name": "Taken"}).status_code == 409
    assert client.put(url, json={"name": " "}).status_code == 422
    response = client.put(url, json={"name": "New", "description": "Better"})
    assert response.status_code == 200
    assert response.json()["name"] == "New"
    assert client.put(url, json={"name": "New"}).status_code == 200
    # Omitted fields stay; null clears the description.
    assert client.put(url, json={}).json()["description"] == "Better"
    assert client.put(url, json={"description": None}).json()["description"] is None
    assert deck_log(deck)[1:] == [
        ("renamed", None, "Old", "New", None),
        ("description_changed", None, "Notes", "Better", None),
        ("description_changed", None, "Better", None, None),
    ]


def test_poster_cards(client, pika, rai):
    deck = create(
        client,
        "Wants",
        deck_type="phantom",
        decklist_text="1 Pikachu SVI 25\n1 Raichu SVI 26",
    )["id"]
    rows = cards_of(client, deck)
    a, b = rows[(pika, "standard")]["id"], rows[(rai, "standard")]["id"]
    url = f"{DECKS}/{deck}"

    def posters():
        return [c["id"] for c in client.get(DECKS).json()[0]["poster_cards"]]

    assert client.put(url, json={"poster_card_ids": [a, b]}).status_code == 200
    assert posters() == [a, b]
    assert client.put(url, json={"poster_card_ids": [b, a]}).status_code == 200
    assert posters() == [b, a]
    assert cards_of(client, deck)[(rai, "standard")]["poster_slot"] == 0
    for bad in ([a, a], [a, 999999], [a, b, a, b]):
        assert client.put(url, json={"poster_card_ids": bad}).status_code == 422
    client.delete(f"{url}/cards/{b}")
    assert posters() == [a]
    client.put(url, json={"poster_card_ids": []})
    assert posters() == []


# ── copy, delete, history ────────────────────────────────────────────────────


def test_copy_a_normal_deck(client, pika):
    card = own(client.user_id, pika, standard=3)
    deck = create(client, "Source", description="Notes")["id"]
    client.post(f"{DECKS}/{deck}/cards", json={"card_id": card, "quantity_in_deck": 2})
    url = f"{DECKS}/{deck}/copy"
    assert client.post(url, json={"name": "Source"}).status_code == 409
    response = client.post(url, json={"name": "Copy"})
    assert response.status_code == 409 and "Only 1" in response.json()["detail"]
    assert deck_count() == 1

    client.put(f"{URL}/collection/{card}", json={"quantity": 4})
    copy = client.post(url, json={"name": "Copy"})
    assert copy.status_code == 201
    copy = copy.json()
    assert copy["description"] == "Notes" and copy["total_cards"] == 2
    assert deck_log(copy["id"]) == [
        ("copied", 'Copied from "Source"', None, None, None),
        ("card_added", "Pikachu", None, "2", "standard"),
    ]


def test_copy_a_phantom_deck(client, pika):
    deck = create(
        client, "Wants", deck_type="phantom", decklist_text="9 Pikachu SVI 25"
    )
    copy = client.post(f"{DECKS}/{deck['id']}/copy", json={"name": "More"}).json()
    assert copy["deck_type"] == "phantom" and copy["total_cards"] == 9


def test_delete_a_deck_keeps_the_cards_and_combats(client, pika):
    card = own(client.user_id, pika, standard=2)
    deck = make_deck(client.user_id)
    put_in_deck(deck, card, 2)
    with database.SessionLocal() as session:
        combat = m.Combat(
            deck_a_id=deck,
            deck_b_id=deck,
            player_a_id=client.user_id,
            player_b_id=client.user_id,
            winner="a",
            loser_score=2,
            played_at=datetime(2026, 1, 1, tzinfo=UTC),
            deck_a_snapshot=[],
            deck_b_snapshot=[],
            deck_a_name_snapshot="Deck",
            deck_b_name_snapshot="Deck",
        )
        session.add(combat)
        session.commit()
        combat_id = combat.id
    assert client.delete(f"{DECKS}/{deck}").status_code == 204
    assert client.get(f"{URL}/collection/{card}").json()["available"] == 2
    with database.SessionLocal() as session:
        assert session.get(m.Combat, combat_id).deck_a_id is None


def test_delete_all_decks(client, other_client, pika):
    card = own(client.user_id, pika)
    put_in_deck(make_deck(client.user_id, "A"), card, 1)
    make_deck(client.user_id, "B", "phantom")
    make_deck(other_client.user_id, "Theirs")
    assert client.delete(DECKS).json() == {"deleted_decks": 2}
    assert client.get(DECKS).json() == []
    assert len(other_client.get(DECKS).json()) == 1
    assert client.get(f"{URL}/collection/{card}").status_code == 200


def test_history_pages(client, pika):
    deck = create(client, "Deck")["id"]
    for name in ("B", "C"):
        client.put(f"{DECKS}/{deck}", json={"name": name})
    page = client.get(f"{DECKS}/{deck}/history", params={"page_size": 2}).json()
    assert page["total"] == 3
    assert [(h["action"], h["new_value"]) for h in page["items"]] == [
        ("renamed", "C"),
        ("renamed", "B"),
    ]
    rest = client.get(f"{DECKS}/{deck}/history", params={"page": 2, "page_size": 2})
    assert [h["action"] for h in rest.json()["items"]] == ["created"]


# ── export / import ──────────────────────────────────────────────────────────


def test_export_then_import_round_trip(client, other_client, pika, rai):
    pika_card = own(client.user_id, pika, standard=2, reverse=1)
    deck = create(client, "Main", description="Notes")["id"]
    client.post(
        f"{DECKS}/{deck}/cards/bulk",
        json={"items": [{"card_id": pika_card, "all_variants": True}]},
    )
    draft = client.post(f"{DECKS}/{deck}/drafts", json={"name": "Up"}).json()
    client.put(
        f"{DECKS}/{deck}/drafts/{draft['id']}/entries/{rai}",
        json={"quantity_delta": 2},
    )
    create(client, "Wants", deck_type="phantom", decklist_text="3 Raichu SVI 26")

    exported = client.get(f"{DECKS}/export").json()
    assert exported == {
        "decks": [
            {
                "name": "Main",
                "description": "Notes",
                "deck_type": "normal",
                "cards": [
                    {
                        "name": "Pikachu",
                        "set_code": "SVI",
                        "card_number": "25",
                        "variant_type": "standard",
                        "quantity_in_deck": 1,
                    },
                    {
                        "name": "Pikachu",
                        "set_code": "SVI",
                        "card_number": "25",
                        "variant_type": "reverse",
                        "quantity_in_deck": 1,
                    },
                ],
                "drafts": [
                    {
                        "name": "Up",
                        "entries": [
                            {
                                "name": "Raichu",
                                "set_code": "SVI",
                                "card_number": "26",
                                "variant_type": "standard",
                                "quantity_delta": 2,
                            }
                        ],
                    }
                ],
            },
            {
                "name": "Wants",
                "description": None,
                "deck_type": "phantom",
                "cards": [
                    {
                        "name": "Raichu",
                        "set_code": "SVI",
                        "card_number": "26",
                        "variant_type": "standard",
                        "quantity_in_deck": 3,
                    }
                ],
            },
        ]
    }
    single = client.get(f"{DECKS}/{deck}/export").json()
    assert single == exported["decks"][0]

    own(other_client.user_id, pika, standard=1, reverse=1)
    response = other_client.post(f"{DECKS}/import-all", json=exported)
    assert response.status_code == 201, response.text
    assert [d["total_cards"] for d in response.json()] == [2, 3]
    assert other_client.get(f"{DECKS}/export").json() == exported
    main = response.json()[0]["id"]
    assert deck_log(main)[0] == ("created", "Main", None, None, None)


def test_old_files_import_unchanged(client, pika):
    own(client.user_id, pika, standard=1)
    old = {
        "name": "Old deck",
        "description": None,
        "deck_type": None,
        "cards": [
            {
                "name": "Pikachu",
                "set_code": "SVI",
                "card_number": "25",
                "image_path": "obsolete/025_pikachu.jpg",
                "set_name": "Old name",
                "quantity_in_deck": 1,
            }
        ],
    }
    response = client.post(f"{DECKS}/import", json=old)
    assert response.status_code == 201, response.text
    assert response.json()["deck_type"] == "normal"
    wdc = old | {"name": "Wdc", "deck_type": "wdc", "cards": []}
    assert client.post(f"{DECKS}/import", json=wdc).json()["deck_type"] == "normal"


def test_import_refusals_create_nothing(client, pika, rai):
    own(client.user_id, pika, standard=1)

    def card(set_code="SVI", number="25", copies=1, variant="standard"):
        return {
            "set_code": set_code,
            "card_number": number,
            "variant_type": variant,
            "quantity_in_deck": copies,
        }

    def deck(name="D", cards=(), deck_type="normal", drafts=None):
        return {
            "name": name,
            "deck_type": deck_type,
            "cards": list(cards),
            "drafts": drafts,
        }

    def draft(*entries):
        return [
            {
                "name": "Up",
                "entries": [
                    {"set_code": "SVI", "card_number": n, "quantity_delta": d}
                    for n, d in entries
                ],
            }
        ]

    create(client, "Taken")
    cases = {
        422: [
            deck(cards=[card(number="999")]),
            deck(cards=[card(variant="reverse_masterball")]),
            deck(deck_type="phantom", drafts=draft(("25", 1))),
            deck(drafts=draft(("25", 1)) * 2),
            deck(drafts=draft(("25", 0))),
            {"name": "", "cards": []},
        ],
        409: [
            deck("Taken"),
            deck(cards=[card(number="26")]),  # not owned
            deck(cards=[card(copies=2)]),  # only 1 owned
            deck(cards=[card()], drafts=draft(("25", -2))),
            deck(cards=[card()], drafts=draft(("26", 5))),
        ],
    }
    for code, bodies in cases.items():
        for body in bodies:
            response = client.post(f"{DECKS}/import", json=body)
            assert response.status_code == code, (body, response.text)
    assert deck_count() == 1

    # import-all: all or nothing, and decks of the file share the copies.
    both = {"decks": [deck("A", [card()]), deck("B", [card()])]}
    response = client.post(f"{DECKS}/import-all", json=both)
    assert response.status_code == 409 and "Only 0" in response.json()["detail"]
    same_name = {"decks": [deck("A"), deck("A")]}
    assert client.post(f"{DECKS}/import-all", json=same_name).status_code == 422
    assert client.post(f"{DECKS}/import-all", json={"decks": []}).status_code == 422
    assert deck_count() == 1


def test_phantom_export_modes(client, pika, rai):
    pika_card = own(client.user_id, pika, standard=3)
    put_in_deck(make_deck(client.user_id, "Real"), pika_card, 2)
    deck = create(
        client,
        "Wants",
        deck_type="phantom",
        decklist_text="4 Pikachu SVI 25\n2 Raichu SVI 26",
    )["id"]

    def exported(mode):
        cards = client.get(f"{DECKS}/{deck}/export", params={"mode": mode}).json()
        return {c["card_number"]: c["quantity_in_deck"] for c in cards["cards"]}

    assert exported("full") == {"25": 4, "26": 2}
    assert exported("missing") == {"25": 1, "26": 2}
    assert exported("not_available") == {"25": 3, "26": 2}
    text = client.get(
        f"{DECKS}/{deck}/export/text", params={"format": "tcgplayer", "mode": "missing"}
    )
    assert text.text == "Pokémon (3)\n1 Pikachu SVI 25\n2 Raichu SVI 26"
    assert (
        client.get(f"{DECKS}/{deck}/export", params={"mode": "other"}).status_code
        == 422
    )


def test_deck_text_export(client, pika, energy):
    deck = create(
        client,
        "Wants",
        deck_type="phantom",
        decklist_text="2 Pikachu SVI 25\n10 Lightning Energy SVI 257",
    )["id"]
    url = f"{DECKS}/{deck}/export/text"
    tcg = client.get(url, params={"format": "tcgplayer"})
    assert tcg.headers["content-type"].startswith("text/plain")
    assert tcg.text == (
        "Pokémon (2)\n2 Pikachu SVI 25\n\nEnergy (10)\n10 Lightning Energy SVI 257"
    )
    assert client.get(url, params={"format": "cardmarket"}).text == (
        "2x Pikachu (Scarlet & Violet)\n10x Lightning Energy (Scarlet & Violet)"
    )
    assert client.get(url, params={"format": "pdf"}).status_code == 422
