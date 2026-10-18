"""`/api/cards/catalog`: browse, sets, missing numbers, one card."""

from datetime import date

import pytest

from core import database
from domains.cards import models as m
from tests.cards.conftest import URL, add_catalog_card, own, set_language

CATALOG = f"{URL}/catalog"


def names(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [card["name"] for card in response.json()["items"]]


# ── access ───────────────────────────────────────────────────────────────────


def test_catalog_needs_the_cards_app(anon, cards_client):
    assert anon.get(CATALOG).status_code == 401
    no_access = cards_client("nope@example.com", apps=("workout",))
    assert no_access.get(CATALOG).status_code == 403
    assert no_access.get(f"{CATALOG}/sets").status_code == 403


def test_admin_without_grant_can_browse(admin):
    assert admin.get(CATALOG).status_code == 200


# ── browse ───────────────────────────────────────────────────────────────────


@pytest.fixture
def catalog():
    return {
        "pika": add_catalog_card(
            card_number="25", name="Pikachu", display_name="Pikachu", rarity="Common"
        ),
        "rai": add_catalog_card(
            card_number="26", name="Raichu", display_name="Raichu", rarity="Rare"
        ),
        "lillie": add_catalog_card(
            card_number="3",
            name="Lillie's Determination",
            display_name="Détermination de Lilie",
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
            variants=("standard", "reverse", "reverse_pokeball"),
            release_date=date(2023, 8, 11),
        ),
    }


def test_search_is_partial_and_ignores_case_and_punctuation(client, catalog):
    set_language(client.user_id, "en")
    assert names(client.get(CATALOG, params={"search": "CHU"})) == [
        "Pikachu",
        "Raichu",
    ]
    assert names(client.get(CATALOG, params={"search": "lillies"})) == [
        "Lillie's Determination"
    ]


def test_search_anchors(client, catalog):
    set_language(client.user_id, "en")
    assert names(client.get(CATALOG, params={"search": "^Pika"})) == ["Pikachu"]
    assert names(client.get(CATALOG, params={"search": "chu$"})) == [
        "Pikachu",
        "Raichu",
    ]
    assert names(client.get(CATALOG, params={"search": "^Pikachu$"})) == ["Pikachu"]
    assert names(client.get(CATALOG, params={"search": "^ikachu$"})) == []


def test_search_matches_the_french_name_and_shows_the_viewers_language(client, catalog):
    set_language(client.user_id, "fr")
    assert names(client.get(CATALOG, params={"search": "dracaufeu"})) == [
        "Dracaufeu-ex"
    ]
    set_language(client.user_id, "en")
    assert names(client.get(CATALOG, params={"search": "dracaufeu"})) == [
        "Charizard ex"
    ]


def test_filters_combine(client, catalog):
    set_language(client.user_id, "en")
    get = lambda **p: names(client.get(CATALOG, params=p))  # noqa: E731
    assert get(set_code="OBF") == ["Charizard ex"]
    assert get(set_name="obsidian") == ["Charizard ex"]
    assert get(supertype="Trainer") == ["Lillie's Determination"]
    assert get(rarity=["Common", "Rare"]) == ["Pikachu", "Raichu"]
    assert get(card_number="2") == ["Charizard ex", "Pikachu", "Raichu"]
    assert get(variant_type="reverse_pokeball") == ["Charizard ex"]
    assert get(rarity="Rare", supertype="Trainer") == []


def test_sorts(client, catalog):
    set_language(client.user_id, "en")
    get = lambda sort: names(client.get(CATALOG, params={"sort": sort}))  # noqa: E731
    assert get("name_desc") == [
        "Raichu",
        "Pikachu",
        "Lillie's Determination",
        "Charizard ex",
    ]
    # Numbers sort as numbers: 3 < 25 < 26 < 125.
    assert get("card_number_asc") == [
        "Lillie's Determination",
        "Pikachu",
        "Raichu",
        "Charizard ex",
    ]
    # Undated sets are the oldest.
    assert get("set_release_desc")[0] == "Charizard ex"
    assert get("set_release_asc")[-1] == "Charizard ex"


def test_french_users_sort_by_the_french_name(client):
    add_catalog_card(card_number="1", name="Abra", display_name="Zeta")
    add_catalog_card(card_number="2", name="Zubat", display_name="Alpha")
    set_language(client.user_id, "fr")
    assert names(client.get(CATALOG)) == ["Alpha", "Zeta"]
    set_language(client.user_id, "en")
    assert names(client.get(CATALOG)) == ["Abra", "Zubat"]


def test_pages_report_the_total(client, catalog):
    page = client.get(CATALOG, params={"page_size": 3}).json()
    assert page["total"] == 4 and len(page["items"]) == 3
    past_end = client.get(CATALOG, params={"page": 9, "page_size": 3}).json()
    assert past_end["total"] == 4 and past_end["items"] == []


def test_browse_items_carry_variants_and_the_french_image(client):
    card_id = add_catalog_card(image_path_fr="SV/SVI/cards/1_fr.jpg")
    set_language(client.user_id, "fr")
    item = client.get(CATALOG).json()["items"][0]
    assert item["id"] == card_id
    assert item["image_path"] == "SV/SVI/cards/1_fr.jpg"
    assert [v["variant_type"] for v in item["variants"]] == ["standard", "reverse"]
    set_language(client.user_id, "en")
    assert client.get(CATALOG).json()["items"][0]["image_path"].endswith("_EN.jpg")


# ── sets ─────────────────────────────────────────────────────────────────────


def sets(client, **params) -> dict[str, dict]:
    response = client.get(f"{CATALOG}/sets", params=params)
    assert response.status_code == 200, response.text
    return {row["set_code"]: row for row in response.json()}


def test_sets_are_newest_first_with_world_championships_last(client):
    add_catalog_card(set_code="OLD", release_date=date(2020, 1, 1))
    add_catalog_card(set_code="NEW", release_date=date(2024, 1, 1))
    add_catalog_card(
        set_code="WC23", series="World Championships", release_date=date(2025, 1, 1)
    )
    add_catalog_card(set_code="NODATE")
    codes = [row["set_code"] for row in client.get(f"{CATALOG}/sets").json()]
    assert codes == ["NEW", "OLD", "NODATE", "WC23"]


def test_set_rows_have_display_names_and_asset_paths(client):
    add_catalog_card(set_name_fr="Écarlate et Violet")
    set_language(client.user_id, "fr")
    row = sets(client)["SVI"]
    assert row["set_name"] == "Écarlate et Violet"
    assert row["logo_path"] == "Scarlet & Violet/SVI/SVI_logo_EN.png"
    assert row["logo_path_fr"] == "Scarlet & Violet/SVI/SVI_logo_FR.png"
    assert row["symbol_path"] == "Scarlet & Violet/SVI/SVI_symbol.png"
    set_language(client.user_id, "en")
    assert sets(client)["SVI"]["set_name"] == "Scarlet & Violet"


def test_default_completion_counts_normal_numbering_and_any_print(client, other_client):
    first = add_catalog_card(card_number="1", card_count=2)
    add_catalog_card(card_number="2", card_count=2)
    secret = add_catalog_card(card_number="3", card_count=2)  # past card_count
    own(client.user_id, first, reverse=1)
    own(client.user_id, secret)
    assert sets(client)["SVI"]["completion_percent"] == 50
    # Another user's collection doesn't count.
    assert sets(other_client)["SVI"]["completion_percent"] == 0


def test_completion_by_exact_rarity_and_print(client):
    """Ported from the old app's test_set_completion."""
    common = add_catalog_card(rarity="Common", card_number="1", card_count=1)
    secret = add_catalog_card(rarity="Ultra Rare", card_number="2", card_count=1)
    own(client.user_id, common, reverse=1)
    own(client.user_id, secret)

    def completion(**params):
        return sets(client, **params)["SVI"]["completion_percent"]

    assert completion(variant_type=["standard", "reverse"]) == 50
    assert completion(variant_type=["standard", "reverse"], rarity="Common") == 50
    assert completion(variant_type=["standard", "reverse", "standard"]) == 50
    assert completion(variant_type="standard") == 50
    assert completion(variant_type="reverse", rarity="Common") == 100
    assert completion(variant_type="standard", rarity="Common") == 0
    assert completion(variant_type="standard", rarity="Ultra Rare") == 100
    assert completion(variant_type="standard", rarity="Uncommon") is None
    assert completion(variant_type="reverse_masterball") is None
    assert completion(reverse=True) == 50
    response = client.get(f"{CATALOG}/sets", params={"variant_type": "unknown"})
    assert response.status_code == 422


def test_selected_rarity_applies_to_sets_without_rarities(client):
    card = add_catalog_card(rarity="No Rarity", card_number="promo")
    own(client.user_id, card)
    assert (
        sets(client, variant_type="standard", rarity="Common")["SVI"][
            "completion_percent"
        ]
        is None
    )
    assert (
        sets(client, variant_type="standard", rarity="No Rarity")["SVI"][
            "completion_percent"
        ]
        == 100
    )


def test_set_cards_are_ordered_by_number(client):
    for number in ("10", "2", "TG01", "1"):
        add_catalog_card(card_number=number, name=f"Card {number}")
    response = client.get(f"{CATALOG}/sets/SVI/cards")
    assert [c["card_number"] for c in response.json()] == ["1", "2", "10", "TG01"]
    assert client.get(f"{CATALOG}/sets/NOPE/cards").status_code == 404


# ── missing numbers ──────────────────────────────────────────────────────────


def missing(client, **params) -> dict[str, dict]:
    response = client.get(f"{CATALOG}/missing-intervals", params=params)
    assert response.status_code == 200, response.text
    return {row["set_code"]: row for row in response.json()}


def test_missing_numbers_collapse_into_intervals(client):
    ids = {
        n: add_catalog_card(card_number=str(n), name=f"Card {n}")
        for n in (1, 2, 3, 4, 5, 7, 8)
    }
    add_catalog_card(card_number="promo1", name="Promo")
    own(client.user_id, ids[3])
    row = missing(client)["SVI"]
    # 3 is owned (a stop), 6 doesn't exist (a gap), the promo isn't numeric.
    assert row["intervals"] == [
        {"start_number": 1, "end_number": 2},
        {"start_number": 4, "end_number": 5},
        {"start_number": 7, "end_number": 8},
    ]
    assert row["missing_count"] == 6
    assert row["owned_numbers"] == [3]
    assert row["symbol_path"] == "Scarlet & Violet/SVI/SVI_symbol.png"


def test_other_rarities_bridge_but_never_start_an_interval(client):
    add_catalog_card(card_number="1", rarity="Common")
    owned_rare = add_catalog_card(card_number="2", rarity="Rare")
    add_catalog_card(card_number="3", rarity="Common")
    add_catalog_card(card_number="4", rarity="Rare")
    own(client.user_id, owned_rare)
    row = missing(client, rarity="Common")["SVI"]
    assert row["intervals"] == [{"start_number": 1, "end_number": 3}]
    assert row["excluded_numbers"] == [2, 4]
    # Only unselected rarities missing: the set isn't listed.
    assert "SVI" not in missing(client, rarity="Ultra Rare")


def test_a_shared_number_stays_missing_until_every_card_is_owned(client):
    first = add_catalog_card(card_number="0", name="Energy A")
    add_catalog_card(card_number="0", name="Energy B")
    own(client.user_id, first)
    assert missing(client)["SVI"]["missing_numbers"] == [0]


def test_missing_by_exact_print(client):
    standard_only = add_catalog_card(card_number="1")
    reverse_owned = add_catalog_card(card_number="2")
    add_catalog_card(card_number="3", variants=("standard",))
    own(client.user_id, standard_only, standard=1)
    own(client.user_id, reverse_owned, reverse=1)
    # Card 3 has no reverse print, so it isn't a target.
    assert missing(client, variant_type="reverse")["SVI"]["missing_numbers"] == [1]
    assert missing(client, reverse=True)["SVI"]["missing_numbers"] == [1]
    assert missing(client, variant_type="standard")["SVI"]["missing_numbers"] == [
        2,
        3,
    ]
    response = client.get(
        f"{CATALOG}/missing-intervals", params={"variant_type": "shiny"}
    )
    assert response.status_code == 422


# ── filter options ───────────────────────────────────────────────────────────


def test_filter_options(client, catalog):
    assert client.get(f"{CATALOG}/supertypes").json() == ["Pokémon", "Trainer"]
    assert client.get(f"{CATALOG}/rarities").json() == [
        "Common",
        "Double Rare",
        "Rare",
        "Uncommon",
    ]
    add_catalog_card(card_number="9", variants=("standard", "reverse_masterball"))
    assert client.get(f"{CATALOG}/variant-types").json() == [
        "reverse",
        "reverse_pokeball",
        "reverse_masterball",
    ]


# ── one card ─────────────────────────────────────────────────────────────────


def test_get_one_card(client, catalog):
    set_language(client.user_id, "fr")
    card = client.get(f"{CATALOG}/{catalog['char']}").json()
    assert card["name"] == "Dracaufeu-ex"
    assert client.get(f"{CATALOG}/999999").status_code == 404
    variants = client.get(f"{CATALOG}/{catalog['char']}/variants").json()
    assert [v["variant_type"] for v in variants] == [
        "standard",
        "reverse",
        "reverse_pokeball",
    ]


def test_only_admins_fix_a_name(client, admin, catalog):
    url = f"{CATALOG}/{catalog['pika']}"
    assert client.patch(url, json={"name": "Pikachu!"}).status_code == 403
    response = admin.patch(url, json={"name": "  Pikachu V  "})
    assert response.status_code == 200
    with database.SessionLocal() as session:
        card = session.get(m.CardCatalog, catalog["pika"])
        assert card.name == "Pikachu V"
        assert card.display_name == "Pikachu"
    assert admin.patch(url, json={"name": "   "}).status_code == 422
    assert admin.patch(f"{CATALOG}/999999", json={"name": "X"}).status_code == 404


def test_deck_usage(client, other_client, catalog):
    card_id = own(client.user_id, catalog["pika"], standard=3, reverse=1)
    with database.SessionLocal() as session:
        normal = m.Deck(user_id=client.user_id, name="Electric")
        phantom = m.Deck(user_id=client.user_id, name="Wishlist", deck_type="phantom")
        theirs = m.Deck(
            user_id=other_client.user_id, name="Theirs", deck_type="phantom"
        )
        session.add_all([normal, phantom, theirs])
        session.flush()
        session.add_all(
            [
                m.DeckCard(deck_id=normal.id, card_id=card_id, quantity_in_deck=2),
                m.DeckCard(
                    deck_id=normal.id,
                    card_id=card_id,
                    variant_type="reverse",
                    quantity_in_deck=1,
                ),
                m.DeckCard(
                    deck_id=phantom.id, catalog_id=catalog["pika"], quantity_in_deck=4
                ),
                m.DeckCard(
                    deck_id=theirs.id, catalog_id=catalog["pika"], quantity_in_deck=1
                ),
            ]
        )
        session.commit()
        normal_id, phantom_id = normal.id, phantom.id

    usage = client.get(f"{CATALOG}/{catalog['pika']}/deck-usage").json()
    assert usage == {
        "allocated_decks": [
            {"deck_id": normal_id, "deck_name": "Electric", "quantity_in_deck": 3}
        ],
        "phantom_decks": [
            {"deck_id": phantom_id, "deck_name": "Wishlist", "quantity_in_deck": 4}
        ],
    }
    # Unowned, wanted by no one of mine: both empty.
    empty = client.get(f"{CATALOG}/{catalog['rai']}/deck-usage").json()
    assert empty == {"allocated_decks": [], "phantom_decks": []}
