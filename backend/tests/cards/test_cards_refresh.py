"""The catalog refresh steps (domains/cards/refresh/), on small fixture HTML
in a temporary CARDS_SOURCE_DIR, with the network faked."""

import re
from pathlib import Path

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from core import database
from domains.cards import display
from domains.cards import models as m
from domains.cards.refresh import (
    card_details,
    html_import,
    scans,
    set_assets,
    source,
    thumbnails,
    variant_icons,
)
from domains.cards.variant_order import ALL_VARIANT_TYPES
from tests.cards.conftest import add_catalog_card
from tests.cards.source_files import (
    card,
    jpeg,
    logo_url,
    scan_url,
    symbol_url,
    write_series_name,
    write_set,
)

REAL_SOURCE = Path(__file__).parents[2] / "domains" / "cards" / "source"
SV = "Scarlet & Violet"


def run_import() -> dict:
    with database.SessionLocal() as db:
        return html_import.import_html(db)


def catalog() -> list[m.CardCatalog]:
    with database.SessionLocal() as db:
        return db.scalars(
            select(m.CardCatalog)
            .options(selectinload(m.CardCatalog.variants))
            .order_by(m.CardCatalog.set_code, m.CardCatalog.id)
        ).all()


def by_number(rows, number) -> m.CardCatalog:
    return next(r for r in rows if r.card_number == number)


# ── the real source ──────────────────────────────────────────────────────────


def test_every_print_in_the_real_source_is_known():
    observed = {
        int(version)
        for path in REAL_SOURCE.rglob("*.html")
        for version in re.findall(
            r"/sets/[^/]+/(?:FR|US)/(\d+)/\d+\.jpg", path.read_text("utf-8")
        )
    }
    assert observed <= source.VERSION_ID_TO_VARIANT.keys()
    assert set(source.VERSION_ID_TO_VARIANT.values()) <= set(ALL_VARIANT_TYPES)


def test_real_source_numbers_come_from_scan_urls_or_grid_position():
    """30C's Dracaufeu alt says 4/102, its scan is card 160; WC23 numbers are
    their own slots; the Energies set is numbered by position."""
    cards_30c = source.parse_set_cards(REAL_SOURCE / "Mega Evolution" / "30C", "30C")
    assert next(c for c in cards_30c if c.name_fr == "Dracaufeu").card_number == "160"
    wc23 = source.parse_set_cards(REAL_SOURCE / "World Championships" / "WC23", "WC23")
    assert next(c for c in wc23 if c.name_en == "Genesect-V").card_number == "3"
    energies = source.parse_set_cards(
        REAL_SOURCE / "Energies" / "Energies", "Energies", number_by_position=True
    )
    assert [(c.card_number, c.name_en) for c in energies[:2]] == [
        ("1", "Grass Energy"),
        ("2", "Fire Energy"),
    ]
    assert energies[0].scan_url_en.endswith("/83.jpg?class=hd")


# ── HTML import ──────────────────────────────────────────────────────────────


def test_import_creates_cards_with_prints_set_facts_and_placeholders(source_dir):
    write_set(
        source_dir,
        SV,
        "SVI",
        [
            card("Sprigatito", "1", name_fr="Poussacha", versions=(2, 94)),
            card("Nest Ball", "181", supertype="Trainer", rarity="Uncommon"),
        ],
    )
    assert run_import() == {"sets_processed": 1, "cards_upserted": 2}

    sprigatito, nest_ball = catalog()
    assert (sprigatito.name, sprigatito.display_name) == ("Sprigatito", "Poussacha")
    assert (sprigatito.set_name, sprigatito.set_name_fr) == (SV, "Écarlate et Violet")
    assert (sprigatito.series, sprigatito.set_code) == (SV, "SVI")
    assert sprigatito.card_count == 198
    assert str(sprigatito.release_date) == "2023-03-31"
    assert (sprigatito.rarity, sprigatito.supertype) == ("Common", "Pokémon")
    assert sprigatito.image_path == "__pending__/SVI/1_1"
    assert sprigatito.source_url == scan_url("SVI", "US", "1")
    assert [v.variant_type for v in sprigatito.variants] == [
        "standard",
        "reverse",
        "reverse_pokeball",
    ]
    reverse = sprigatito.variants[1]
    assert reverse.source_url_en == scan_url("SVI", "US", "1", 2)
    assert reverse.source_url_fr == scan_url("SVI", "FR", "1", 2)
    assert (nest_ball.supertype, nest_ball.rarity) == ("Trainer", "Uncommon")


def test_reimport_updates_in_place_and_follows_a_corrected_number(source_dir):
    write_set(source_dir, SV, "SVI", [card("Sprigatito", "1"), card("Fuecoco", "4")])
    run_import()
    fuecoco_id = by_number(catalog(), "4").id
    # Stored under a stale number (an older import read the alt text), with
    # its scan downloaded; plus a card the source no longer has.
    with database.SessionLocal() as db:
        fuecoco = db.get(m.CardCatalog, fuecoco_id)
        fuecoco.card_number = "99"
        fuecoco.image_path = f"{SV}/SVI/cards/99_fuecoco_standard_EN.jpg"
        db.commit()
    gone = add_catalog_card(set_code="OLD", name="Gone", series="Old")
    write_set(
        source_dir,
        SV,
        "SVI",
        [card("Sprigatito", "1"), card("Fuecoco", "4", versions=(2,))],
        name="Scarlet and Violet",
    )

    run_import()

    rows = catalog()
    fuecoco = next(r for r in rows if r.name == "Fuecoco")
    assert fuecoco.id == fuecoco_id
    assert fuecoco.card_number == "4"
    assert fuecoco.image_path == f"{SV}/SVI/cards/99_fuecoco_standard_EN.jpg"
    assert fuecoco.set_name == "Scarlet and Violet"
    assert [v.variant_type for v in fuecoco.variants] == ["standard", "reverse"]
    assert len([r for r in rows if r.set_code == "SVI"]) == 2
    assert any(r.id == gone for r in rows)


def test_a_stale_number_never_takes_over_another_cards_row(source_dir):
    """A row whose saved scan URL is another slot's isn't reused for this
    slot just because its number matches: its own slot repairs it."""
    write_set(source_dir, SV, "SVI", [card("Sprigatito", "1"), card("Fuecoco", "4")])
    run_import()
    with database.SessionLocal() as db:
        rows = db.scalars(select(m.CardCatalog)).all()
        sprigatito = next(r for r in rows if r.name == "Sprigatito")
        fuecoco = next(r for r in rows if r.name == "Fuecoco")
        # Swapped numbers, each keeping its own scan URL.
        sprigatito.card_number, fuecoco.card_number = "tmp", "1"
        db.flush()
        sprigatito.card_number = "4"
        db.commit()
    run_import()
    assert {(r.name, r.card_number) for r in catalog()} == {
        ("Sprigatito", "1"),
        ("Fuecoco", "4"),
    }


def test_basic_energy_names_are_generic_but_the_energies_set_keeps_dates(source_dir):
    write_set(source_dir, SV, "SVE", [card("Basic Fire Energy", "2")])
    write_set(
        source_dir,
        "Energies",
        "Energies",
        [card("Water Energy (2022) /104", "83"), card("Grass Energy", "12")],
        name="Energies",
    )
    run_import()
    rows = catalog()
    energies = [r for r in rows if r.set_code == "Energies"]
    # Numbered by position, not by their CDN numbers.
    assert [(r.card_number, r.name) for r in energies] == [
        ("1", "Water Energy (2022) /104"),
        ("2", "Grass Energy"),
    ]
    assert next(r for r in rows if r.set_code == "SVE").name == "Fire Energy"


def test_unknown_prints_and_missing_french_slots(source_dir):
    write_set(
        source_dir,
        SV,
        "SVI",
        [card("Sprigatito", "1", versions=(9999,), fr=False)],
    )
    run_import()
    (sprigatito,) = catalog()
    assert sprigatito.display_name == "Sprigatito"
    assert [v.variant_type for v in sprigatito.variants] == ["standard"]
    assert sprigatito.variants[0].source_url_fr is None


def test_alt_number_is_ignored_for_the_card_number(source_dir):
    write_set(source_dir, SV, "SVI", [card("Charizard", "160", alt="4")])
    run_import()
    assert catalog()[0].card_number == "160"


def test_a_set_without_header_is_skipped(source_dir):
    folder = write_set(source_dir, SV, "SVI", [card("Sprigatito", "1")])
    (folder / "SVI_fr_header.html").unlink()
    assert run_import() == {"sets_processed": 0, "cards_upserted": 0}


def test_import_clears_the_series_label_cache(source_dir):
    write_series_name(source_dir, SV, "Ancien nom")
    assert display.series_name(SV, "fr") == "Ancien nom"
    write_series_name(source_dir, SV, "Écarlate et Violet")
    write_set(source_dir, SV, "SVI", [card("Sprigatito", "1")])
    run_import()
    assert display.series_name(SV, "fr") == "Écarlate et Violet"


# ── scans ────────────────────────────────────────────────────────────────────


def test_scrape_images_downloads_missing_scans_and_keeps_failed_ones_pending(
    source_dir, data_dir, web
):
    write_set(
        source_dir,
        SV,
        "SVI",
        [card("Sprigatito", "1", versions=(2,)), card("Mr. Mime", "2")],
    )
    run_import()
    web.add(scan_url("SVI", "US", "1"), b"en")
    web.add(scan_url("SVI", "FR", "1"), b"fr")
    web.add(scan_url("SVI", "US", "1", 2), b"rev-en")
    web.add(scan_url("SVI", "FR", "1", 2), status=404)
    web.add(scan_url("SVI", "US", "2"), status=500)
    web.add(scan_url("SVI", "FR", "2"), status=404)
    saved, progress = [], []

    with database.SessionLocal() as db:
        result = scans.scrape_images(
            db,
            data_dir,
            on_standard_saved=saved.append,
            on_progress=lambda done, total: progress.append((done, total)),
        )

    assert result == {"images_downloaded": 1}
    assert progress[0] == (0, 6) and progress[-1] == (6, 6)
    sprigatito, mime = catalog()
    base = f"{SV}/SVI/cards/1_sprigatito"
    assert sprigatito.image_path == f"{base}_standard_EN.jpg"
    assert sprigatito.image_path_fr == f"{base}_standard_FR.jpg"
    assert (data_dir / sprigatito.image_path).read_bytes() == b"en"
    reverse = sprigatito.variants[1]
    assert (reverse.image_path_us, reverse.image_path_fr) == (
        f"{base}_reverse_EN.jpg",
        None,
    )
    assert sorted(p.name for p in saved) == [
        "1_sprigatito_standard_EN.jpg",
        "1_sprigatito_standard_FR.jpg",
    ]
    assert mime.image_path == "__pending__/SVI/2_2"

    # A rerun only asks for what is still missing (the reverse has a scan).
    web.requests.clear()
    with database.SessionLocal() as db:
        scans.scrape_images(db, data_dir)
    assert sorted(web.requests) == sorted(
        [scan_url("SVI", "US", "2"), scan_url("SVI", "FR", "2")]
    )


def test_world_championship_names_keep_the_slot_and_energies_fall_back_to_french():
    row = m.CardCatalog(
        series="World Championships", set_code="WC22", card_number="123", name="Cheryl"
    )
    assert (
        scans.image_path_for(row, scan_url("WC22", "US", "56"), "standard", "en")
        == "World Championships/WC22/cards/56_123_cheryl_standard_EN.jpg"
    )
    energy = m.CardCatalog(
        series="Energies",
        image_path="__pending__/Energies/1_1",
        image_path_fr="Energies/Energies/cards/1_grass_energy_standard_FR.jpg",
    )
    assert scans.use_energies_french_fallback(energy)
    assert energy.image_path == energy.image_path_fr


def test_link_existing_files_fills_only_pending_or_missing_paths(source_dir, data_dir):
    write_set(source_dir, SV, "SVI", [card("Bulbasaur", "1", versions=(2,))])
    run_import()
    base = data_dir / SV / "SVI" / "cards"
    base.mkdir(parents=True)
    for suffix in ("standard_EN", "standard_FR", "reverse_EN"):
        (base / f"1_bulbasaur_{suffix}.jpg").write_bytes(b"x")
    progress = []
    with database.SessionLocal() as db:
        linked = scans.link_existing_files(
            db, data_dir, lambda done, total: progress.append((done, total))
        )
    assert linked == 3
    assert progress == [(0, 1), (1, 1)]
    (row,) = catalog()
    assert row.image_path == f"{SV}/SVI/cards/1_bulbasaur_standard_EN.jpg"
    assert row.image_path_fr == f"{SV}/SVI/cards/1_bulbasaur_standard_FR.jpg"
    assert row.variants[1].image_path_us == f"{SV}/SVI/cards/1_bulbasaur_reverse_EN.jpg"
    assert row.variants[1].image_path_fr is None
    with database.SessionLocal() as db:
        assert scans.link_existing_files(db, data_dir) == 0


# ── thumbnails ───────────────────────────────────────────────────────────────


def test_thumbnails_for_downloaded_standard_scans_only(data_dir):
    scan = data_dir / SV / "SVI" / "cards" / "1_a_standard_EN.jpg"
    scan.parent.mkdir(parents=True)
    scan.write_bytes(jpeg(600, 840))
    add_catalog_card(image_path=f"{SV}/SVI/cards/1_a_standard_EN.jpg")
    add_catalog_card(card_number="2", image_path="__pending__/SVI/2_2")
    add_catalog_card(card_number="3", image_path=f"{SV}/SVI/cards/missing.jpg")

    with database.SessionLocal() as db:
        assert thumbnails.generate_thumbnails(db, data_dir) == {
            "thumbnails_generated": 1
        }
    thumb = data_dir / SV / "SVI" / "thumbnails" / "1_a_standard_EN.jpg"
    with Image.open(thumb) as img:
        assert img.size == (300, 420)
    with database.SessionLocal() as db:
        assert thumbnails.generate_thumbnails(db, data_dir) == {
            "thumbnails_generated": 0
        }


def test_a_broken_scan_does_not_stop_thumbnails(data_dir):
    scan = data_dir / "broken.jpg"
    scan.write_bytes(b"not a jpeg")
    assert not thumbnails.make_thumbnail(scan)


# ── set logos and symbols ────────────────────────────────────────────────────


def test_logos_and_symbols_are_downloaded_once(source_dir, data_dir, web):
    write_set(source_dir, SV, "SVI", [card("Sprigatito", "1")])
    web.add(logo_url("SVI", "US"), b"logo-en")
    web.add(logo_url("SVI", "FR"), status=404)
    web.add(symbol_url("SVI"), b"symbol")

    assert set_assets.scrape_logos_symbols(data_dir) == {"set_logos_updated": 1}
    folder = data_dir / SV / "SVI"
    assert (folder / "SVI_logo_EN.png").read_bytes() == b"logo-en"
    assert (folder / "SVI_symbol.png").read_bytes() == b"symbol"
    assert not (folder / "SVI_logo_FR.png").exists()

    web.requests.clear()
    assert set_assets.scrape_logos_symbols(data_dir) == {"set_logos_updated": 0}
    assert web.requests == [logo_url("SVI", "FR")]


# ── variant badges ───────────────────────────────────────────────────────────


def test_every_print_has_a_badge_source():
    files = variant_icons.sources()
    assert len(files) == len(source.VERSION_ID_TO_VARIANT) + 1
    assert files["holo_cosmos.png"].endswith("versions/version_39.png")
    assert files["standard.svg"].endswith("card_normale.svg")
    assert files["reverse.svg"].endswith("card_reverse.svg")


def test_badges_seen_in_the_source_are_downloaded_and_kept(source_dir, data_dir, web):
    cosmos = variant_icons.sources()["holo_cosmos.png"]
    standard = variant_icons.sources()["standard.svg"]
    (source_dir / "grid.html").write_text(
        f'<img src="{cosmos}"><img src="{standard}">', "utf-8"
    )
    web.add(cosmos, b"png")
    web.add(standard, status=503)

    assert variant_icons.download_variant_icons(data_dir) == {
        "variant_icons_downloaded": 1,
        "variant_icons_unavailable": ["standard.svg"],
    }
    assert (data_dir / "variant-icons" / "holo_cosmos.png").read_bytes() == b"png"
    web.requests.clear()
    variant_icons.download_variant_icons(data_dir)
    assert web.requests == [standard]


# ── TCGdex details ───────────────────────────────────────────────────────────

TCGDEX = card_details.API


def test_details_match_main_sets_by_name_and_number(data_dir, web):
    sprigatito = add_catalog_card(set_name="Scarlet & Violet", card_number="001")
    special = add_catalog_card(
        card_number="2", series="World Championships", set_code="WC22"
    )
    promo = add_catalog_card(card_number="3", set_code="SVP", set_name="SV Promo")
    ambiguous = add_catalog_card(card_number="4", set_code="DUP", set_name="Duplicate")
    known = add_catalog_card(card_number="5", details={"en": {"hp": 90}})
    web.json(
        f"{TCGDEX}/en/sets",
        [
            {"id": "sv01", "name": "Scarlet & Violet"},
            {"id": "a", "name": "Duplicate"},
            {"id": "b", "name": "Duplicate"},
        ],
    )
    web.json(
        f"{TCGDEX}/en/sets/sv01", {"cards": [{"id": "sv01-001", "localId": "001"}]}
    )
    web.json(
        f"{TCGDEX}/en/cards/sv01-001",
        {"set": {"id": "sv01"}, "localId": "001", "hp": 70, "unused": 1},
    )
    web.add(f"{TCGDEX}/fr/cards/sv01-001", status=404)
    progress = []

    with database.SessionLocal() as db:
        result = card_details.import_details(
            db, data_dir, lambda done, total: progress.append((done, total))
        )

    assert result == dict(matched=1, unmatched=1, skipped=3, failed=0, french_missing=1)
    assert progress[-1] == (5, 5)
    with database.SessionLocal() as db:
        assert db.get(m.CardCatalog, sprigatito).details == {"en": {"hp": 70}}
        assert db.get(m.CardCatalog, known).details == {"en": {"hp": 90}}
        for untouched in (special, promo, ambiguous):
            assert db.get(m.CardCatalog, untouched).details is None
    # Responses are cached on disk: a rerun asks nothing already fetched.
    assert (data_dir / "card-details" / "en" / "cards" / "sv01-001.json").is_file()
    with database.SessionLocal() as db:
        db.get(m.CardCatalog, sprigatito).details = None
        db.commit()
    web.requests.clear()
    with database.SessionLocal() as db:
        card_details.import_details(db, data_dir)
    assert web.requests == [f"{TCGDEX}/fr/cards/sv01-001"]  # the 404 isn't cached


def test_a_mismatched_or_failed_card_is_left_alone(data_dir, web):
    sprigatito = add_catalog_card(set_name="Base Set", card_number="1")
    web.json(f"{TCGDEX}/en/sets", [{"id": "base1", "name": "Base Set"}])
    web.json(f"{TCGDEX}/en/sets/base1", {"cards": [{"id": "base1-1", "localId": "1"}]})
    web.json(f"{TCGDEX}/en/cards/base1-1", {"set": {"id": "other"}, "localId": "1"})
    with database.SessionLocal() as db:
        assert card_details.import_details(db, data_dir)["failed"] == 1
    web.add(f"{TCGDEX}/en/cards/base1-1", status=500)
    (data_dir / "card-details" / "en" / "cards" / "base1-1.json").unlink()
    with database.SessionLocal() as db:
        assert card_details.import_details(db, data_dir)["failed"] == 1
        assert db.get(m.CardCatalog, sprigatito).details is None
