"""`/api/cards/collection`: owned cards, search, add (also into a deck),
quantity edits, history, export/import, delete-all."""

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

COLLECTION = f"{URL}/collection"


def history(user_id: int) -> list[tuple]:
    """(catalog_id, print, action, source, old, new), oldest first."""
    with database.SessionLocal() as session:
        rows = session.scalars(
            select(m.CollectionHistory)
            .where(m.CollectionHistory.user_id == user_id)
            .order_by(m.CollectionHistory.id)
        )
        return [
            (
                h.catalog_id,
                h.variant_type,
                h.action,
                h.source,
                h.old_quantity,
                h.new_quantity,
            )
            for h in rows
        ]


def quantities(user_id: int) -> dict[tuple[int, str], int]:
    with database.SessionLocal() as session:
        rows = session.execute(
            select(
                m.Card.catalog_id,
                m.CardVariantQuantity.variant_type,
                m.CardVariantQuantity.quantity,
            )
            .join(m.CardVariantQuantity.card)
            .where(m.Card.user_id == user_id)
        )
        return {(cid, variant): q for cid, variant, q in rows}


def count(model) -> int:
    with database.SessionLocal() as session:
        return session.scalar(select(func.count()).select_from(model))


@pytest.fixture
def pika():
    return add_catalog_card(
        card_number="25",
        name="Pikachu",
        display_name="Pikachu FR",
        set_name_fr="Écarlate et Violet",
        image_path_fr="Scarlet & Violet/SVI/cards/25_pikachu_standard_FR.jpg",
        variants=("standard", "reverse", "reverse_pokeball"),
    )


@pytest.fixture
def rai():
    return add_catalog_card(card_number="26", name="Raichu", rarity="Rare")


# ── access ───────────────────────────────────────────────────────────────────


def test_collection_needs_the_cards_app(anon, cards_client):
    assert anon.get(COLLECTION).status_code == 401
    no_access = cards_client("nope@example.com", apps=("media",))
    for path in ("", "/search", "/filter-options", "/history", "/export"):
        assert no_access.get(COLLECTION + path).status_code == 403


def test_other_users_cards_are_hidden(client, other_client, pika):
    mine = own(client.user_id, pika)
    theirs = own(other_client.user_id, pika, standard=3)
    assert [c["id"] for c in client.get(COLLECTION).json()] == [mine]
    assert client.get(f"{COLLECTION}/{theirs}").status_code == 404
    body = {"variant_type": "standard", "quantity": 1}
    assert client.put(f"{COLLECTION}/{theirs}", json=body).status_code == 404
    assert client.delete(f"{COLLECTION}/{theirs}").status_code == 404
    assert quantities(other_client.user_id) == {(pika, "standard"): 3}


# ── add ──────────────────────────────────────────────────────────────────────


def test_add_creates_then_increments_and_logs(client, pika):
    response = client.post(COLLECTION, json={"catalog_id": pika, "quantity": 2})
    assert response.status_code == 201, response.text
    card = response.json()
    assert card["quantity"] == 2
    assert card["variants"][0] == {
        "variant_type": "standard",
        "quantity": 2,
        "image_path_fr": None,
        "image_path_us": None,
    }
    again = client.post(
        COLLECTION, json={"catalog_id": pika, "variant_type": "reverse"}
    ).json()
    assert again["id"] == card["id"]
    assert [(v["variant_type"], v["quantity"]) for v in again["variants"]] == [
        ("standard", 2),
        ("reverse", 1),
    ]
    client.post(COLLECTION, json={"catalog_id": pika, "quantity": 3})
    assert history(client.user_id) == [
        (pika, "standard", "added", "manual", None, 2),
        (pika, "reverse", "added", "manual", None, 1),
        (pika, "standard", "increased", "manual", 2, 5),
    ]


def test_add_all_variants(client, pika):
    card = client.post(
        COLLECTION, json={"catalog_id": pika, "quantity": 2, "all_variants": True}
    ).json()
    assert [(v["variant_type"], v["quantity"]) for v in card["variants"]] == [
        ("standard", 2),
        ("reverse", 2),
        ("reverse_pokeball", 2),
    ]
    assert card["quantity"] == 6


def test_add_refuses_unknown_card_or_print(client, rai):
    assert client.post(COLLECTION, json={"catalog_id": 999999}).status_code == 404
    response = client.post(
        COLLECTION, json={"catalog_id": rai, "variant_type": "reverse_masterball"}
    )
    assert response.status_code == 422
    assert (
        client.post(COLLECTION, json={"catalog_id": rai, "quantity": 0}).status_code
        == 422
    )
    assert quantities(client.user_id) == {}
    assert history(client.user_id) == []


def test_variant_scans_come_from_the_catalog(client, pika):
    with database.SessionLocal() as session:
        variant = session.scalar(
            select(m.CardCatalogVariant).where(
                m.CardCatalogVariant.card_catalog_id == pika,
                m.CardCatalogVariant.variant_type == "reverse",
            )
        )
        variant.image_path_us = "rev_US.jpg"
        variant.image_path_fr = "rev_FR.jpg"
        session.commit()
    own(client.user_id, pika, reverse=1)
    [card] = client.get(COLLECTION).json()
    assert card["variants"] == [
        {
            "variant_type": "reverse",
            "quantity": 1,
            "image_path_fr": "rev_FR.jpg",
            "image_path_us": "rev_US.jpg",
        }
    ]


# ── list, allocations, language ──────────────────────────────────────────────


def test_list_reports_allocations_per_print_and_decks(client, pika, rai):
    card_id = own(client.user_id, pika, standard=4, reverse=2)
    own(client.user_id, rai)
    electric = make_deck(client.user_id, "Electric")
    another = make_deck(client.user_id, "Another")
    wishlist = make_deck(client.user_id, "Wishlist", "phantom")
    put_in_deck(electric, card_id, 2)
    put_in_deck(electric, card_id, 1, "reverse")
    put_in_deck(another, card_id, 1)
    with database.SessionLocal() as session:
        # A phantom row wants the catalog card; it never counts as allocated.
        session.add(m.DeckCard(deck_id=wishlist, catalog_id=pika, quantity_in_deck=4))
        session.commit()

    cards = {c["catalog_id"]: c for c in client.get(COLLECTION).json()}
    assert cards[pika]["quantity"] == 6
    assert cards[pika]["allocated"] == 4
    assert cards[pika]["allocated_variants"] == {"standard": 3, "reverse": 1}
    assert cards[pika]["available"] == 2
    assert cards[pika]["decks"] == [
        {"deck_id": another, "deck_name": "Another", "quantity_in_deck": 1},
        {"deck_id": electric, "deck_name": "Electric", "quantity_in_deck": 3},
    ]
    assert cards[rai]["allocated"] == 0 and cards[rai]["available"] == 1
    assert cards[rai]["allocated_variants"] == {} and cards[rai]["decks"] == []
    assert client.get(f"{COLLECTION}/{card_id}").json()["available"] == 2


def test_list_by_set(client, pika):
    obf = add_catalog_card(set_code="OBF", set_name="Obsidian Flames", name="Charizard")
    own(client.user_id, pika)
    own(client.user_id, obf)
    listed = client.get(COLLECTION, params={"set_code": "OBF"}).json()
    assert [c["catalog_id"] for c in listed] == [obf]


def test_display_fields_follow_the_language(client, pika):
    own(client.user_id, pika)
    set_language(client.user_id, "fr")
    [card] = client.get(COLLECTION).json()
    assert card["name"] == "Pikachu FR"
    assert card["set_name"] == "Écarlate et Violet"
    assert card["image_path"].endswith("_FR.jpg")
    set_language(client.user_id, "en")
    [card] = client.get(COLLECTION).json()
    assert (card["name"], card["set_name"]) == ("Pikachu", "Scarlet & Violet")


# ── search ───────────────────────────────────────────────────────────────────


@pytest.fixture
def owned_cards(client, other_client):
    """Five owned cards; Pikachu fully in a deck."""
    ids = {
        "pika": add_catalog_card(
            card_number="25", name="Pikachu", variants=("standard", "reverse")
        ),
        "rai": add_catalog_card(card_number="26", name="Raichu", rarity="Rare"),
        "boss": add_catalog_card(
            card_number="172",
            name="Boss's Orders",
            supertype="Trainer",
            rarity="Uncommon",
        ),
        "char": add_catalog_card(
            set_code="OBF",
            set_name="Obsidian Flames",
            card_number="125",
            name="Charizard ex",
            display_name="Dracaufeu-ex",
            rarity="Double Rare",
        ),
        "unowned": add_catalog_card(card_number="27", name="Pichu"),
    }
    pika_card = own(client.user_id, ids["pika"], standard=2, reverse=1)
    own(client.user_id, ids["rai"], standard=3)
    own(client.user_id, ids["boss"])
    own(client.user_id, ids["char"], standard=1)
    own(other_client.user_id, ids["unowned"], standard=9)
    deck = make_deck(client.user_id)
    put_in_deck(deck, pika_card, 2)
    put_in_deck(deck, pika_card, 1, "reverse")
    return ids


def found(client, **params) -> list[str]:
    response = client.get(f"{COLLECTION}/search", params=params)
    assert response.status_code == 200, response.text
    return [card["name"] for card in response.json()["items"]]


def test_search_filters(client, owned_cards):
    set_language(client.user_id, "en")
    assert found(client) == ["Boss's Orders", "Charizard ex", "Pikachu", "Raichu"]
    assert found(client, search="chu") == ["Pikachu", "Raichu"]
    assert found(client, search="bosss") == ["Boss's Orders"]
    assert found(client, search="dracaufeu") == ["Charizard ex"]
    assert found(client, set_code="OBF") == ["Charizard ex"]
    assert found(client, set_name="obsidian") == ["Charizard ex"]
    assert found(client, supertype="Trainer") == ["Boss's Orders"]
    assert found(client, rarity=["Rare", "Double Rare"]) == ["Charizard ex", "Raichu"]
    assert found(client, card_number="12") == ["Charizard ex"]
    assert found(client, variant_type="reverse") == ["Pikachu"]
    assert found(client, available="unavailable") == ["Pikachu"]
    assert found(client, available="available", search="chu") == ["Raichu"]
    bad = client.get(f"{COLLECTION}/search", params={"available": "maybe"})
    assert bad.status_code == 422


def test_search_sorts_and_names_in_the_users_language(client, owned_cards):
    set_language(client.user_id, "fr")
    assert found(client) == ["Boss's Orders", "Dracaufeu-ex", "Pikachu", "Raichu"]
    assert found(client, sort="name_desc")[0] == "Raichu"
    assert found(client, sort="card_number_desc") == [
        "Boss's Orders",
        "Dracaufeu-ex",
        "Raichu",
        "Pikachu",
    ]


def test_search_pages_and_totals(client, owned_cards):
    page = client.get(f"{COLLECTION}/search", params={"page_size": 3, "page": 2}).json()
    assert [c["name"] for c in page["items"]] == ["Raichu"]
    assert page["total"] == 4
    # 3 Pikachu + 3 Raichu + 1 Boss + 1 Charizard.
    assert page["total_quantity"] == 8
    assert page["collection_total_quantity"] == 8

    filtered = client.get(f"{COLLECTION}/search", params={"search": "chu"}).json()
    assert (filtered["total"], filtered["total_quantity"]) == (2, 6)
    assert filtered["collection_total_quantity"] == 8
    assert filtered["items"][0]["available"] == 0

    past_the_end = client.get(
        f"{COLLECTION}/search", params={"search": "chu", "page": 5}
    ).json()
    assert past_the_end["items"] == []
    assert (past_the_end["total"], past_the_end["total_quantity"]) == (2, 6)
    nothing = client.get(f"{COLLECTION}/search", params={"search": "zzz"}).json()
    assert (nothing["total"], nothing["total_quantity"]) == (0, 0)


def test_search_pages_never_overlap_on_equal_names(client):
    for number in range(1, 8):
        own(client.user_id, add_catalog_card(card_number=str(number), name="Same"))
    seen = []
    for page in (1, 2, 3):
        response = client.get(
            f"{COLLECTION}/search", params={"page_size": 3, "page": page}
        )
        seen += [c["id"] for c in response.json()["items"]]
    assert len(seen) == len(set(seen)) == 7


def test_filter_options_cover_the_whole_collection(client, owned_cards):
    set_language(client.user_id, "en")
    options = client.get(f"{COLLECTION}/filter-options").json()
    assert options == {
        "sets": [
            {"set_code": "OBF", "set_name": "Obsidian Flames"},
            {"set_code": "SVI", "set_name": "Scarlet & Violet"},
        ],
        "rarities": ["Common", "Double Rare", "Rare", "Uncommon"],
        "owned_variant_types": ["reverse"],
    }


# ── quantity edit ────────────────────────────────────────────────────────────


def test_set_quantity_is_absolute_and_logged(client, pika):
    card_id = own(client.user_id, pika, standard=2)
    url = f"{COLLECTION}/{card_id}"
    card = client.put(url, json={"variant_type": "standard", "quantity": 5}).json()
    assert card["quantity"] == 5
    client.put(url, json={"variant_type": "standard", "quantity": 1})
    client.put(url, json={"variant_type": "reverse", "quantity": 2})
    # Unchanged: nothing logged.
    client.put(url, json={"variant_type": "reverse", "quantity": 2})
    assert history(client.user_id) == [
        (pika, "standard", "increased", "manual", 2, 5),
        (pika, "standard", "decreased", "manual", 5, 1),
        (pika, "reverse", "added", "manual", None, 2),
    ]


def test_set_quantity_zero_removes_the_print_then_the_card(client, pika):
    card_id = own(client.user_id, pika, standard=1, reverse=2)
    url = f"{COLLECTION}/{card_id}"
    card = client.put(url, json={"variant_type": "standard", "quantity": 0}).json()
    assert [v["variant_type"] for v in card["variants"]] == ["reverse"]
    response = client.put(url, json={"variant_type": "reverse", "quantity": 0})
    assert response.status_code == 200 and response.json() is None
    assert client.get(url).status_code == 404
    assert history(client.user_id)[-2:] == [
        (pika, "standard", "removed", "manual", 1, None),
        (pika, "reverse", "removed", "manual", 2, None),
    ]


def test_set_quantity_only_for_catalog_prints(client, rai):
    card_id = own(client.user_id, rai)
    response = client.put(
        f"{COLLECTION}/{card_id}",
        json={"variant_type": "reverse_pokeball", "quantity": 1},
    )
    assert response.status_code == 422
    assert (
        client.put(
            f"{COLLECTION}/{card_id}", json={"variant_type": "standard", "quantity": -1}
        ).status_code
        == 422
    )


def test_set_quantity_not_below_what_decks_use(client, pika):
    card_id = own(client.user_id, pika, standard=3, reverse=1)
    put_in_deck(make_deck(client.user_id), card_id, 2)
    url = f"{COLLECTION}/{card_id}"
    response = client.put(url, json={"variant_type": "standard", "quantity": 1})
    assert response.status_code == 409
    # Another print's allocation doesn't hold this one back.
    assert (
        client.put(url, json={"variant_type": "reverse", "quantity": 0}).status_code
        == 200
    )
    assert (
        client.put(url, json={"variant_type": "standard", "quantity": 2}).status_code
        == 200
    )
    assert quantities(client.user_id) == {(pika, "standard"): 2}


# ── delete ───────────────────────────────────────────────────────────────────


def test_delete_card(client, pika):
    card_id = own(client.user_id, pika, standard=2, reverse=1)
    assert client.delete(f"{COLLECTION}/{card_id}").status_code == 204
    assert quantities(client.user_id) == {}
    assert history(client.user_id) == [
        (pika, "standard", "removed", "manual", 2, None),
        (pika, "reverse", "removed", "manual", 1, None),
    ]


def test_delete_refused_while_in_a_deck(client, pika):
    card_id = own(client.user_id, pika)
    put_in_deck(make_deck(client.user_id), card_id, 1)
    assert client.delete(f"{COLLECTION}/{card_id}").status_code == 409
    assert quantities(client.user_id) == {(pika, "standard"): 1}
    assert history(client.user_id) == []


# ── bulk add ─────────────────────────────────────────────────────────────────


def test_bulk_add_merges_repeats(client, pika, rai):
    own(client.user_id, rai, standard=1)
    response = client.post(
        f"{COLLECTION}/bulk",
        json={
            "items": [
                {"catalog_id": rai, "quantity": 2},
                {"catalog_id": pika, "quantity": 1},
                {"catalog_id": rai, "quantity": 1},
                {"catalog_id": pika, "quantity": 1, "all_variants": True},
            ]
        },
    )
    assert response.status_code == 201, response.text
    assert [c["catalog_id"] for c in response.json()] == [rai, pika]
    assert quantities(client.user_id) == {
        (rai, "standard"): 4,
        (pika, "standard"): 2,
        (pika, "reverse"): 1,
        (pika, "reverse_pokeball"): 1,
    }
    assert (rai, "standard", "increased", "manual", 1, 4) in history(client.user_id)


def test_bulk_add_is_all_or_nothing(client, pika, rai):
    items = [{"catalog_id": pika, "quantity": 1}, {"catalog_id": 999999, "quantity": 1}]
    assert client.post(f"{COLLECTION}/bulk", json={"items": items}).status_code == 404
    items[1] = {"catalog_id": rai, "variant_type": "reverse_masterball", "quantity": 1}
    assert client.post(f"{COLLECTION}/bulk", json={"items": items}).status_code == 422
    assert client.post(f"{COLLECTION}/bulk", json={"items": []}).status_code == 422
    assert quantities(client.user_id) == {}
    assert history(client.user_id) == []


def test_bulk_add_into_a_deck(client, pika, rai):
    deck = make_deck(client.user_id)
    rai_card = own(client.user_id, rai, standard=1)
    put_in_deck(deck, rai_card, 1)
    response = client.post(
        f"{COLLECTION}/bulk",
        json={
            "deck_id": deck,
            "items": [
                {"catalog_id": pika, "quantity": 2},
                {"catalog_id": pika, "variant_type": "reverse", "quantity": 1},
                {"catalog_id": rai, "quantity": 2},
            ],
        },
    )
    assert response.status_code == 201, response.text
    cards = {c["catalog_id"]: c for c in response.json()}
    assert cards[pika]["allocated_variants"] == {"standard": 2, "reverse": 1}
    assert cards[pika]["available"] == 0
    assert cards[rai]["allocated"] == 3 and cards[rai]["quantity"] == 3
    with database.SessionLocal() as session:
        log = session.scalars(
            select(m.DeckHistory)
            .where(m.DeckHistory.deck_id == deck)
            .order_by(m.DeckHistory.id)
        ).all()
        assert [
            (h.action, h.detail, h.old_value, h.new_value, h.variant_type) for h in log
        ] == [
            ("card_added", "Pikachu", None, "2", "standard"),
            ("card_added", "Pikachu", None, "1", "reverse"),
            ("card_quantity_changed", "Raichu", "1", "3", "standard"),
        ]
        assert session.get(m.Deck, deck).has_wdc_cards is False


def test_bulk_add_into_a_deck_follows_the_deck_limits(client, pika):
    deck = make_deck(client.user_id)

    def add(catalog_id, quantity, variant="standard"):
        return client.post(
            f"{COLLECTION}/bulk",
            json={
                "deck_id": deck,
                "items": [
                    {
                        "catalog_id": catalog_id,
                        "variant_type": variant,
                        "quantity": quantity,
                    }
                ],
            },
        )

    # 4 copies per card, over every print.
    assert add(pika, 3).status_code == 201
    response = add(pika, 2, "reverse")
    assert response.status_code == 409
    assert "Pikachu" in response.json()["detail"]
    # Refused: the collection add is rolled back too.
    assert quantities(client.user_id) == {(pika, "standard"): 3}

    # Basic Energy has no copy limit, but a deck stops at 60.
    energy = add_catalog_card(
        card_number="300", name="Basic L Energy", variants=("standard",)
    )
    assert add(energy, 50).status_code == 201
    assert add(energy, 8).status_code == 409
    assert add(energy, 7).status_code == 201


def test_bulk_add_into_a_wdc_deck_sets_the_tag(client):
    wdc = add_catalog_card(set_code="WDC", name="Old", series="World Championships")
    deck = make_deck(client.user_id)
    client.post(
        f"{COLLECTION}/bulk", json={"deck_id": deck, "items": [{"catalog_id": wdc}]}
    )
    with database.SessionLocal() as session:
        assert session.get(m.Deck, deck).has_wdc_cards is True


def test_bulk_add_refuses_phantom_and_other_users_decks(client, other_client, pika):
    items = [{"catalog_id": pika, "quantity": 1}]
    phantom = make_deck(client.user_id, "Want", "phantom")
    theirs = make_deck(other_client.user_id)
    response = client.post(
        f"{COLLECTION}/bulk", json={"deck_id": phantom, "items": items}
    )
    assert response.status_code == 422
    response = client.post(
        f"{COLLECTION}/bulk", json={"deck_id": theirs, "items": items}
    )
    assert response.status_code == 404
    assert quantities(client.user_id) == {}


# ── history ──────────────────────────────────────────────────────────────────


def test_history_newest_first_paged_and_searchable(client, pika, rai):
    for catalog_id in (pika, rai, pika):
        client.post(COLLECTION, json={"catalog_id": catalog_id})
    set_language(client.user_id, "fr")
    page = client.get(f"{COLLECTION}/history", params={"page_size": 2}).json()
    assert page["total"] == 3
    assert [(e["name"], e["action"]) for e in page["items"]] == [
        ("Pikachu FR", "increased"),
        ("Raichu", "added"),
    ]
    entry = page["items"][0]
    assert (entry["old_quantity"], entry["new_quantity"], entry["source"]) == (
        1,
        2,
        "manual",
    )
    assert entry["set_name"] == "Écarlate et Violet"
    second = client.get(
        f"{COLLECTION}/history", params={"page_size": 2, "page": 2}
    ).json()
    assert [e["action"] for e in second["items"]] == ["added"]
    searched = client.get(f"{COLLECTION}/history", params={"search": "rai"}).json()
    assert [e["catalog_id"] for e in searched["items"]] == [rai]
    beyond = client.get(
        f"{COLLECTION}/history", params={"search": "pika", "page": 9}
    ).json()
    assert beyond["total"] == 2 and beyond["items"] == []


def test_history_is_per_user(client, other_client, pika):
    other_client.post(COLLECTION, json={"catalog_id": pika})
    assert client.get(f"{COLLECTION}/history").json()["total"] == 0


# ── export / import ──────────────────────────────────────────────────────────


def test_export_import_round_trip(client, other_client, pika, rai):
    set_language(client.user_id, "fr")
    own(client.user_id, pika, standard=2, reverse_pokeball=1)
    own(client.user_id, rai, standard=3)
    exported = client.get(f"{COLLECTION}/export").json()
    assert exported["cards"][0] == {
        "name": "Pikachu",
        "set_name": "Scarlet & Violet",
        "set_code": "SVI",
        "card_number": "25",
        "image_path": "Scarlet & Violet/SVI/cards/25_pikachu_standard_EN.jpg",
        "variants": [
            {"variant_type": "standard", "quantity": 2},
            {"variant_type": "reverse_pokeball", "quantity": 1},
        ],
    }
    response = other_client.post(f"{COLLECTION}/import", json=exported)
    assert response.json() == {"imported": 2, "imported_quantity": 6}
    assert quantities(other_client.user_id) == quantities(client.user_id)
    assert {h[2:4] for h in history(other_client.user_id)} == {("added", "import")}


def test_import_replaces_listed_prints_only(client, pika):
    own(client.user_id, pika, standard=5, reverse=1)
    image_path = "Scarlet & Violet/SVI/cards/25_pikachu_standard_EN.jpg"
    # An old export, as written by the old app: extra null scan fields.
    old_file = {
        "cards": [
            {
                "name": "Pikachu",
                "set_name": "Scarlet & Violet",
                "set_code": "SVI",
                "card_number": "25",
                "image_path": image_path,
                "variants": [
                    {
                        "variant_type": "standard",
                        "quantity": 2,
                        "image_path_fr": None,
                        "image_path_us": None,
                    },
                    {
                        "variant_type": "reverse_pokeball",
                        "quantity": 1,
                        "image_path_fr": None,
                        "image_path_us": None,
                    },
                ],
            }
        ]
    }
    response = client.post(f"{COLLECTION}/import", json=old_file)
    assert response.status_code == 200, response.text
    assert quantities(client.user_id) == {
        (pika, "standard"): 2,
        (pika, "reverse"): 1,
        (pika, "reverse_pokeball"): 1,
    }
    assert history(client.user_id) == [
        (pika, "standard", "decreased", "import", 5, 2),
        (pika, "reverse_pokeball", "added", "import", None, 1),
    ]


def test_import_is_all_or_nothing(client, pika, rai):
    card_id = own(client.user_id, pika, standard=3)
    put_in_deck(make_deck(client.user_id), card_id, 2)
    good = {
        "image_path": "Scarlet & Violet/SVI/cards/26_raichu_standard_EN.jpg",
        "variants": [{"variant_type": "standard", "quantity": 4}],
    }
    pika_path = "Scarlet & Violet/SVI/cards/25_pikachu_standard_EN.jpg"

    def post(*cards):
        return client.post(f"{COLLECTION}/import", json={"cards": list(cards)})

    unknown = post(
        good,
        {
            "name": "Ghost",
            "image_path": "nope.jpg",
            "variants": [{"variant_type": "standard", "quantity": 1}],
        },
    )
    assert unknown.status_code == 422 and "Ghost" in unknown.json()["detail"]
    no_print = post(
        good,
        {
            "image_path": pika_path,
            "variants": [{"variant_type": "reverse_masterball", "quantity": 1}],
        },
    )
    assert no_print.status_code == 422
    below_decks = post(
        good,
        {
            "image_path": pika_path,
            "variants": [{"variant_type": "standard", "quantity": 1}],
        },
    )
    assert below_decks.status_code == 409 and "Pikachu" in below_decks.json()["detail"]
    assert post(good, {"image_path": pika_path, "variants": []}).status_code == 422
    assert (
        post(
            good,
            {
                "image_path": pika_path,
                "variants": [{"variant_type": "standard", "quantity": 0}],
            },
        ).status_code
        == 422
    )
    assert post().status_code == 422
    assert client.post(f"{COLLECTION}/import", json={"nope": []}).status_code == 422
    assert quantities(client.user_id) == {(pika, "standard"): 3}
    assert history(client.user_id) == []


# ── delete all ───────────────────────────────────────────────────────────────


def _combat(session, player_id, deck_a, deck_b):
    session.add(
        m.Combat(
            deck_a_id=deck_a,
            deck_b_id=deck_b,
            player_a_id=player_id,
            player_b_id=player_id,
            winner="a",
            loser_score=2,
            played_at=datetime(2026, 1, 1, tzinfo=UTC),
            deck_a_snapshot=[],
            deck_b_snapshot=[],
            deck_a_name_snapshot="A",
            deck_b_name_snapshot="B",
        )
    )


def test_delete_all_wipes_cards_decks_and_their_combats(
    client, other_client, pika, rai
):
    mine = own(client.user_id, pika, standard=2, reverse=1)
    own(client.user_id, rai)
    theirs = own(other_client.user_id, pika)
    my_deck = make_deck(client.user_id)
    make_deck(client.user_id, "Want", "phantom")
    their_deck = make_deck(other_client.user_id)
    put_in_deck(my_deck, mine, 1)
    put_in_deck(their_deck, theirs, 1)
    with database.SessionLocal() as session:
        _combat(session, other_client.user_id, their_deck, my_deck)
        _combat(session, other_client.user_id, their_deck, their_deck)
        session.commit()

    response = client.delete(COLLECTION)
    assert response.json() == {"deleted_cards": 2, "deleted_decks": 2}
    assert client.get(COLLECTION).json() == []
    assert quantities(other_client.user_id) == {(pika, "standard"): 1}
    assert count(m.Deck) == 1 and count(m.DeckCard) == 1
    # Only the combat that used one of my decks is gone.
    assert count(m.Combat) == 1
    assert sorted(h[1:3] for h in history(client.user_id)) == [
        ("reverse", "removed"),
        ("standard", "removed"),
        ("standard", "removed"),
    ]
