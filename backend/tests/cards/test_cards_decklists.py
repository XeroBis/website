"""Decklist parsing and rendering (domains/cards/decklists.py), the converter
(`/api/cards/convert`) and the set missing-cards text exports."""

from datetime import date

import pytest

from core import database
from domains.cards import decklists
from domains.cards import models as m
from tests.cards.conftest import (
    URL,
    add_catalog_card,
    make_deck,
    own,
    put_in_deck,
    set_language,
)

CONVERT = f"{URL}/convert/decklist"


def moves(*attacks, abilities=()):
    return {
        "en": {
            "abilities": [{"name": a} for a in abilities],
            "attacks": [{"name": a} for a in attacks],
        }
    }


def cardmarket(catalog_id, include_sets=True, set_code=None) -> str:
    """One copy of the card rendered as a Cardmarket line (`set_code`
    pretends it's from another set)."""
    with database.SessionLocal() as db:
        card = db.get(m.CardCatalog, catalog_id)
        if set_code:
            card.set_code = set_code
        return decklists.render_cardmarket([decklists.entry(card, 1)], include_sets)


def parsed(text) -> list[int | None]:
    with database.SessionLocal() as db:
        return [
            line.card.id if line.card else None for line in decklists.parse(db, text)[1]
        ]


@pytest.fixture
def mew():
    return add_catalog_card(
        set_code="MEW",
        card_number="151",
        name="Mew ex",
        set_name="151",
        details={
            "en": {
                "abilities": [{"name": "Restart"}],
                "attacks": [{"name": "Genome Hacking"}],
            },
            "fr": {
                "abilities": [{"name": "Redémarrage"}],
                "attacks": [{"name": "Piratage du Génome"}],
            },
        },
    )


# ── converter ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("include_sets,suffix", [(True, " (151)"), (False, "")])
def test_converter_renders_abilities_then_attacks(client, mew, include_sets, suffix):
    response = client.post(
        CONVERT, json={"text": "2 Mew ex MEW 151", "include_sets": include_sets}
    )
    assert response.status_code == 200
    assert response.json()["converted_text"] == (
        f"2x Mew ex [Restart | Genome Hacking]{suffix}"
    )


def test_converter_lists_every_line(client, mew):
    zap = add_catalog_card(
        card_number="145",
        name="Zapdos",
        display_name="Électhor",
        set_name_fr="Écarlate et Violet",
    )
    set_language(client.user_id, "fr")
    text = "Pokémon (3)\n1 Zapdos SVI 145\n2 Ghost XYZ 1\n\nTotal Cards: 3"
    body = client.post(CONVERT, json={"text": text}).json()
    assert body["detected_format"] == "tcgplayer"
    assert body["entries"] == [
        {
            "quantity": 1,
            "matched": True,
            "name": "Électhor",
            "set_name": "Écarlate et Violet",
            "set_code": "SVI",
            "card_number": "145",
            "image_path": "Scarlet & Violet/SVI/cards/145_zapdos_standard_EN.jpg",
            "catalog_id": zap,
        },
        {
            "quantity": 2,
            "matched": False,
            "name": "Ghost",
            "set_name": None,
            "set_code": None,
            "card_number": None,
            "image_path": None,
            "catalog_id": None,
        },
    ]
    # The converted text stays English; an unmatched line keeps its name.
    assert body["converted_text"] == "1x Zapdos (Scarlet & Violet)\n2x Ghost"

    back = client.post(CONVERT, json={"text": body["converted_text"]}).json()
    assert back["detected_format"] == "cardmarket"
    assert back["converted_text"] == "Pokémon (3)\n1 Zapdos SVI 145\n2 Ghost ??? ?"
    empty = client.post(CONVERT, json={"text": "hello world"}).json()
    assert empty == {"detected_format": None, "converted_text": "", "entries": []}


def test_tcgplayer_numbers_ignore_padding_and_case(mew):
    padded = add_catalog_card(set_code="PAF", card_number="016", name="Charmander")
    promo = add_catalog_card(set_code="SVP", card_number="SVP001", name="Promo")
    assert parsed("1 Charmander paf 16\n1 Promo SVP svp001") == [padded, promo]


# ── rendering ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("supertype", ["Trainer", "Energy"])
def test_only_pokemon_get_a_bracket(supertype):
    card = add_catalog_card(
        name="Technical Machine", supertype=supertype, details=moves("Evolution")
    )
    assert cardmarket(card, include_sets=False) == "1x Technical Machine"


def test_no_details_no_bracket_and_moves_stay_english(mew):
    card = add_catalog_card(name="No details")
    assert cardmarket(card, include_sets=False) == "1x No details"
    with database.SessionLocal() as db:
        line = decklists.entry(db.get(m.CardCatalog, mew), 1, "fr")
        line.name = "Mew ex FR"
        assert decklists.render_cardmarket([line]) == (
            "1x Mew ex FR [Restart | Genome Hacking] (151)"
        )


def test_basic_energy_renders_generic(mew):
    energy = add_catalog_card(
        set_code="SVE", card_number="4", name="Basic L Energy", supertype="Energy"
    )
    assert cardmarket(energy, include_sets=False) == "1x Lightning Energy"


def test_set_title_loses_its_code_suffix():
    card = add_catalog_card(set_code="TWM", set_name="Twilight Masquerade (TWM)")
    assert cardmarket(card) == "1x Sprigatito (Twilight Masquerade)"


# ── Cardmarket matching ──────────────────────────────────────────────────────


@pytest.mark.parametrize("suffix", [" (151)", ""])
def test_brackets_pick_among_same_name_cards(mew, suffix):
    add_catalog_card(
        set_code="MEW",
        card_number="1",
        name="Mew ex",
        set_name="151",
        details=moves("Other attack"),
    )
    assert parsed(f"2x Mew ex [Restart | Genome Hacking]{suffix}") == [mew]


def test_unknown_moves_keep_the_fallback(mew):
    add_catalog_card(set_code="MEW", card_number="999", name="Mew ex", set_name="151")
    assert parsed("1x Mew ex [Unknown attack] (151)") != [None]


def test_set_code_picks_the_print_before_moves(mew):
    other = add_catalog_card(
        set_code="OTHER",
        card_number="1",
        name="Mew ex",
        set_name="Other set",
        details=moves("Genome Hacking", abilities=("Restart",)),
    )
    assert parsed("1x Mew ex [Restart | Genome Hacking] (other)") == [other]


def test_ties_pick_the_latest_print_then_lowest_number():
    add_catalog_card(
        set_code="OLD", card_number="1", name="Boss", release_date=date(2020, 1, 1)
    )
    undated = add_catalog_card(set_code="UND", card_number="1", name="Boss")
    late = add_catalog_card(
        set_code="NEW", card_number="9", name="Boss", release_date=date(2024, 1, 1)
    )
    add_catalog_card(
        set_code="NEW", card_number="10", name="Boss", release_date=date(2024, 1, 1)
    )
    assert parsed("1x Boss") == [late]
    assert parsed("1x Boss (UND)") == [undated]
    # Older un-parenthesized lines: the name, then the set title.
    assert parsed("1x Boss Scarlet & Violet") == [late]


def test_punctuation_is_optional():
    lillie = add_catalog_card(name="Lillie’s Determination", supertype="Trainer")
    assert parsed("1x Lillies Determination\n1x Lillie's Determination") == [
        lillie,
        lillie,
    ]


@pytest.mark.parametrize("gender,token", [("♀", "[F]"), ("♂", "[M]")])
def test_nidoran_gender_round_trip(gender, token):
    card = add_catalog_card(
        name=f"Nidoran {gender}", details=moves("Growl", "Headbutt")
    )
    text = cardmarket(card)
    assert f"Nidoran {token} [Growl | Headbutt]" in text
    assert parsed(text) == [card]


def test_30c_mew_gets_the_product_qualifier():
    card = add_catalog_card(
        set_code="30C",
        card_number="065",
        name="Mew",
        set_name="30th Celebration",
        details=moves("Psychic"),
    )
    assert cardmarket(card) == "1x Mew [Psychic | 30C] (30th Celebration)"
    assert cardmarket(card, set_code="MEW") == "1x Mew [Psychic] (30th Celebration)"


@pytest.mark.parametrize(
    "number,attack,qualifier",
    [
        ("10", "Flame Tail", "30"),
        ("20", "Wormhole", "30"),
        ("23", "Thunder Shock", "30"),
        ("24", "Volt Tackle", "30"),
        ("25", "Spark", "30"),
        ("39", "Iron Tail", "30"),
        ("65", "Psychic", "30C"),
        ("78", "Splash", "30"),
        ("79", "Stiffen", "30"),
        ("113", "Pay Day", "30"),
        ("121", "Elemental Blast", "30"),
    ],
)
def test_30c_qualifiers_need_the_print_and_moves(number, attack, qualifier):
    identifiers = decklists.cardmarket_identifiers
    assert identifiers("30C", number.zfill(3), [attack]) == [attack, qualifier]
    assert identifiers("OTHER", number, [attack]) == [attack]
    assert identifiers("30C", number, ["Different attack"]) == ["Different attack"]


def test_30c_qualifiers_are_not_guessed():
    identifiers = decklists.cardmarket_identifiers
    assert identifiers("30C", "999", ["Pay Day"]) == ["Pay Day"]
    # Meowth forms.
    assert identifiers("30C", "089", ["Pay Day"]) == ["Pay Day"]
    assert identifiers("30C", "144", ["Pay Day"]) == ["Pay Day"]


@pytest.mark.parametrize(
    "number,name,ability,bracket",
    [
        ("152", "Antique Dome Fossil", "Domed Armor", "Armure Dôme"),
        ("153", "Antique Helix Fossil", "Helical Swell", "Houle Nautile"),
        ("154", "Antique Old Amber", "Amber Protection", "Protection Ambre"),
    ],
)
def test_mew_fossils_get_their_cardmarket_bracket(number, name, ability, bracket):
    card = add_catalog_card(
        set_code="MEW",
        card_number=number,
        name=name,
        set_name="151",
        supertype="Trainer",
        details=moves(abilities=(ability,)),
    )
    text = cardmarket(card)
    assert text == f"1x {name} [{bracket}] (151)"
    assert parsed(text) == [card]
    # Other Trainers with an ability keep no bracket.
    assert cardmarket(card, set_code="BLK") == f"1x {name} (151)"


def test_black_bolt_main_print_gets_sv_over_its_illustration_rare():
    main = add_catalog_card(
        set_code="BLK",
        card_number="001",
        name="Snivy",
        set_name="Black Bolt",
        details=moves("Tackle", "Vine Whip"),
    )
    rare = add_catalog_card(
        set_code="BLK",
        card_number="087",
        name="Snivy",
        set_name="Black Bolt",
        details=moves("Tackle", "Vine Whip"),
    )
    main_text = cardmarket(main, include_sets=False)
    assert main_text == "1x Snivy [Tackle | Vine Whip | SV]"
    assert cardmarket(rare, include_sets=False) == "1x Snivy [Tackle | Vine Whip]"
    assert parsed(main_text) == [main]


def test_miraidon_identifier_round_trips():
    card = add_catalog_card(
        set_code="30C",
        card_number="062",
        name="Miraidon",
        set_name="30th Celebration",
        details=moves("Mach Bolt", "Electro Drift"),
    )
    add_catalog_card(
        set_code="30C",
        card_number="1",
        name="Miraidon",
        set_name="30th Celebration",
        details=moves("Mach Bolt"),
    )
    text = cardmarket(card)
    assert text == "1x Miraidon [Mach Bolt | Mach Bolt] (30th Celebration)"
    assert parsed(text) == [card]


@pytest.mark.parametrize("include_sets", [True, False])
@pytest.mark.parametrize(
    "set_code,name,attacks,product",
    [
        (
            "PBL",
            "Mandibuzz",
            ["Bone Sniper", "Blasting Wind"],
            "Mandibuzz [Bone Snipe | Blasting Wind]",
        ),
        ("PBL", "Shadowy Darkness Energy", [], "Shadowy D Energy"),
        ("PBL", "Voltaic Lightning Energy", [], "Voltaic L Energy"),
        ("CRI", "Magnetic Metal Energy", [], "Magnetic [M] Energy"),
        ("CRI", "Nitro Fire Energy", [], "Nitro [R] Energy"),
        ("CRI", "Bubbly Water Energy", [], "Bubbly [W] Energy"),
        ("POR", "Telepathic Psychic Energy", [], "Telepathic [P] Energy"),
        ("POR", "Growing Grass Energy", [], "Growing [G] Energy"),
        ("PFL", "Lokix", ["Low Kick", "Jumping Shot"], "Lokix [Low Kick | Jump Shot]"),
        ("PFL", "Pawmot", ["Voltaic Fist"], "Pawmot [Voltage Fist]"),
        ("BLK", "Escavalier", ["Wild Lances"], "Escavalier [Wild Lance]"),
        (
            "PAF",
            "Grapploct",
            ["Slow-Acting Syncope", "Mach Cross"],
            "Grapploct [Slow-Acting Hold | Mach Cross]",
        ),
        (
            "PAR",
            "Golisopod",
            ["Powerful Cross", "Waterfall"],
            "Golisopod [Power Cross | Waterfall]",
        ),
        (
            "PAR",
            "Ferrothorn",
            ["Exoskeleton", "Spinning Needles"],
            "Ferrothorn [Exoskeleton | Spinning Needle]",
        ),
        (
            "PAR",
            "Tinkaton",
            ["Crushing Blow", "Alloyed Hammer"],
            "Tinkaton [Knock Off | Wild Press]",
        ),
        ("OBF", "Gumshoos", ["Headbang", "Crunch"], "Gumshoos [Headbutt | Crunch]"),
        (
            "MEW",
            "Nidoking",
            ["Enthusiastic King", "Venomous Impact"],
            "Nidoking [Enthusiastic King | Venom Impact]",
        ),
        (
            "MEW",
            "Psyduck",
            ["Overthink", "Water Gun"],
            "Psyduck [Overthinking | Water Gun]",
        ),
    ],
)
def test_cardmarket_product_names_round_trip(
    set_code, name, attacks, product, include_sets
):
    card = add_catalog_card(
        set_code=set_code,
        set_name=set_code,
        name=name,
        supertype="Pokémon" if attacks else "Energy",
        details=moves(*attacks),
    )
    # A competing print makes the corrected bracket necessary to match.
    if attacks:
        add_catalog_card(
            set_code=set_code,
            set_name=set_code,
            card_number="999",
            name=name,
            details=moves("Other move"),
        )
    text = cardmarket(card, include_sets)
    assert text == f"1x {product}" + (f" ({set_code})" if include_sets else "")
    assert parsed(text) == [card]
    with database.SessionLocal() as db:
        catalog_card = db.get(m.CardCatalog, card)
        assert name in decklists.render_tcgplayer([decklists.entry(catalog_card, 1)])
        assert decklists.move_names(catalog_card) == attacks
    # Only that set's print is renamed.
    assert product not in cardmarket(card, set_code="OTHER")


def prints(text) -> list[tuple[int | None, str]]:
    with database.SessionLocal() as db:
        return [
            (line.card.id if line.card else None, line.variant_type)
            for line in decklists.parse(db, text)[1]
        ]


@pytest.mark.parametrize(
    "set_code, set_name, variants, suffixes",
    [
        # Most ball sets: V.1 Poké Ball, V.2 Master Ball.
        (
            "BLK",
            "Black Bolt",
            ("standard", "reverse", "reverse_pokeball", "reverse_masterball"),
            {
                "standard": "(Black Bolt)",
                "reverse_pokeball": "(V.1) (Black Bolt: Additionals)",
                "reverse_masterball": "(V.2) (Black Bolt: Additionals)",
            },
        ),
        # Ascended Heroes: V.1 the plain reverse, V.2 the card's one ball,
        # whichever it is.
        (
            "ASC",
            "Ascended Heroes",
            ("standard", "reverse", "reverse_friendball"),
            {
                "reverse": "(V.1) (Ascended Heroes: Additionals)",
                "reverse_friendball": "(V.2) (Ascended Heroes: Additionals)",
            },
        ),
        (
            "ASC",
            "Ascended Heroes",
            ("standard", "reverse", "reverse_pokeball"),
            {"reverse_pokeball": "(V.2) (Ascended Heroes: Additionals)"},
        ),
    ],
)
def test_additionals_prints_round_trip(set_code, set_name, variants, suffixes):
    card = add_catalog_card(
        set_code=set_code, set_name=set_name, name="Victini", variants=variants
    )
    for variant, suffix in suffixes.items():
        with database.SessionLocal() as db:
            line = decklists.entry(db.get(m.CardCatalog, card), 1, variant_type=variant)
            text = decklists.render_cardmarket([line])
        assert text == f"1x Victini {suffix}"
        assert prints(text) == [(card, variant)]


def test_unversioned_additionals_is_the_poke_ball():
    card = add_catalog_card(
        set_code="PRE",
        set_name="Prismatic Evolutions",
        name="Buddy-Buddy Poffin",
        supertype="Trainer",
        variants=("standard", "reverse", "reverse_pokeball"),
    )
    text = "1x Buddy-Buddy Poffin (Prismatic Evolutions: Additionals)"
    assert prints(text) == [(card, "reverse_pokeball")]
    # Its only Additionals product is exported unversioned too.
    with database.SessionLocal() as db:
        line = decklists.entry(db.get(m.CardCatalog, card), 1, "en", "reverse_pokeball")
        assert decklists.render_cardmarket([line], include_sets=False) == text
    # A print the card doesn't come in falls back to the standard one.
    assert prints(
        "1x Buddy-Buddy Poffin (V.2) (Prismatic Evolutions: Additionals)"
    ) == [(card, "standard")]


# ── set missing-cards exports ────────────────────────────────────────────────


@pytest.fixture
def base_set():
    """Two cards of set `base1`, both printed in standard and reverse."""
    return {
        "standard_owned": add_catalog_card(
            set_code="base1", card_number="1", name="Standard owned"
        ),
        "reverse_owned": add_catalog_card(
            set_code="base1", card_number="2", name="Reverse owned", rarity="Rare"
        ),
    }


def test_missing_export_by_exact_print(client, base_set):
    own(client.user_id, base_set["standard_owned"], standard=1)
    own(client.user_id, base_set["reverse_owned"], reverse=1)
    url = f"{URL}/catalog/sets/base1/missing/text"
    assert client.get(url).text == ""
    reverse = client.get(url, params={"variant_type": "reverse"})
    assert reverse.status_code == 200
    assert reverse.text == "1x Standard owned (Scarlet & Violet)"
    standard = client.get(
        url, params={"variant_type": "standard", "format": "tcgplayer"}
    )
    assert standard.text == "Pokémon (1)\n1 Reverse owned base1 2"
    assert client.get(url, params={"variant_type": "reverse_masterball"}).text == ""
    assert client.get(url, params={"variant_type": "unknown"}).status_code == 422
    assert client.get(f"{URL}/catalog/sets/nope/missing/text").status_code == 404


def test_missing_export_names_the_additionals_product(client):
    add_catalog_card(
        set_code="ASC",
        set_name="Ascended Heroes",
        name="Bayleef",
        variants=("standard", "reverse", "reverse_friendball"),
    )
    url = f"{URL}/catalog/sets/ASC/missing/text"
    ball = client.get(url, params={"variant_type": "reverse_friendball"})
    assert ball.text == "1x Bayleef (V.2) (Ascended Heroes: Additionals)"
    reverse = client.get(url, params={"variant_type": "reverse"})
    assert reverse.text == "1x Bayleef (V.1) (Ascended Heroes: Additionals)"
    assert client.get(url).text == "1x Bayleef (Ascended Heroes)"


def test_missing_export_options(client, base_set):
    card = own(client.user_id, base_set["standard_owned"], standard=1)
    put_in_deck(make_deck(client.user_id), card, 1)
    with database.SessionLocal() as db:
        db.get(m.CardCatalog, base_set["reverse_owned"]).display_name = "Possédé"
        db.commit()
    url = f"{URL}/catalog/sets/base1/missing/text"
    assert client.get(url, params={"language": "fr"}).text == (
        "1x Possédé (Scarlet & Violet)"
    )
    assert client.get(url, params={"rarity": "Common"}).text == ""
    in_decks = client.get(url, params={"exclude_deck_allocated": True})
    assert in_decks.text.splitlines() == [
        "1x Standard owned (Scarlet & Violet)",
        "1x Reverse owned (Scarlet & Violet)",
    ]


def test_missing_export_over_several_sets(client, base_set):
    add_catalog_card(set_code="base2", card_number="1", name="Other set card")
    url = f"{URL}/catalog/sets/missing/text"
    response = client.post(
        url, params={"format": "tcgplayer"}, json={"set_codes": ["base2", "base1"]}
    )
    assert response.text == (
        "Pokémon (3)\n1 Standard owned base1 1\n1 Reverse owned base1 2\n"
        "1 Other set card base2 1"
    )
    unknown = client.post(url, json={"set_codes": ["base1", "nope"]})
    assert unknown.status_code == 404 and "nope" in unknown.json()["detail"]
    assert client.post(url, json={"set_codes": []}).status_code == 422
