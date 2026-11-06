"""Refresh step `import_html`: upsert the catalog and its print variants from
CARDS_SOURCE_DIR (local parsing only; scans are downloaded by scans.py)."""

import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from domains.cards import display
from domains.cards import models as m
from domains.cards.names import canonical_energy_name
from domains.cards.refresh import source

logger = logging.getLogger(__name__)


def _english_name(series: str, name: str) -> str:
    """`Basic <X> Energy` as the generic `<X> Energy`; the `Energies` set's
    dated prints keep their full name (`Water Energy (2022) /104`)."""
    return name if series == source.ENERGIES_SERIES else canonical_energy_name(name)


def _url_changed(old: tuple[str | None, str | None], new: dict) -> bool:
    """A scan URL now differs from the recorded one, query included (e.g.
    `?class=md` -> `?class=hd`). A URL appearing or disappearing isn't one."""
    return any(
        before and after and before != after
        for before, after in zip(old, (new["en"], new["fr"]))
    )


def _redownload(
    row: m.CardCatalog, variant: m.CardCatalogVariant, slot: source.CardSlot
) -> None:
    """Mark both scans of the print to download again (scans.py overwrites the
    files under the same names)."""
    if variant.variant_type == "standard":
        if not row.image_path.startswith(source.PENDING_PREFIX):
            row.image_path = source.pending_image_path(
                row.set_code, row.card_number, slot.scan_url_en
            )
        row.image_path_fr = None
    else:
        variant.image_path_us = variant.image_path_fr = None
        variant.no_scan = False


def import_html(db: Session, root: Path | None = None) -> dict:
    """One catalog row per card slot, matched first by its English standard
    scan URL (so a corrected number updates the row in place, keeping its
    scans and every link to it), then by (set_code, card_number); one variant
    row per print the grids show, with its scan URLs. Rows and prints no
    longer in the source are kept."""
    rows = db.scalars(
        select(m.CardCatalog).options(selectinload(m.CardCatalog.variants))
    ).all()
    by_number = {(row.set_code, row.card_number): row for row in rows}
    by_scan = {
        source.without_query(row.source_url): row for row in rows if row.source_url
    }

    sets_processed = cards_upserted = redownloads = 0
    for series, set_code, set_dir in source.iter_sets(root):
        try:
            header = source.parse_set_header(set_dir, set_code)
        except FileNotFoundError:
            logger.warning("import_html: no header HTML for %s, skipped", set_code)
            continue
        slots = source.parse_set_cards(
            set_dir, set_code, number_by_position=series == source.ENERGIES_SERIES
        )
        if not slots:
            logger.warning("import_html: no card in %s, skipped", set_code)
            continue

        for slot in slots:
            key = (set_code, slot.card_number)
            scan_key = (
                source.without_query(slot.scan_url_en) if slot.scan_url_en else None
            )
            row = by_scan.get(scan_key) if scan_key else None
            if row is None:
                candidate = by_number.get(key)
                # A row saved with another scan URL has a stale number: its
                # own slot repairs it by scan URL, so don't overwrite it here.
                if candidate is not None and (
                    not candidate.source_url
                    or not scan_key
                    or source.without_query(candidate.source_url) == scan_key
                ):
                    row = candidate
            if row is None:
                row = m.CardCatalog(
                    set_code=set_code,
                    card_number=slot.card_number,
                    image_path=source.pending_image_path(
                        set_code, slot.card_number, slot.scan_url_en
                    ),
                )
                db.add(row)
                by_number[key] = row

            if (row.set_code, row.card_number) != key:
                logger.info(
                    "import_html: %s card number %s -> %s (from its scan URL)",
                    set_code,
                    row.card_number,
                    slot.card_number,
                )
                if by_number.get((row.set_code, row.card_number)) is row:
                    del by_number[(row.set_code, row.card_number)]
                # A placeholder follows the number, so it can't collide with
                # the real card at the old number.
                if row.image_path.startswith(source.PENDING_PREFIX):
                    row.image_path = source.pending_image_path(
                        set_code, slot.card_number, slot.scan_url_en
                    )
                row.card_number = slot.card_number
                by_number[key] = row

            row.name = _english_name(series, slot.name_en)
            row.display_name = slot.name_fr or row.name
            row.series = series
            row.set_name = header.set_name
            row.set_name_fr = header.set_name_fr
            row.rarity = slot.rarity
            row.supertype = slot.supertype
            row.card_count = header.card_count
            row.release_date = header.release_date
            previous_source_url = row.source_url
            if slot.scan_url_en:
                row.source_url = slot.scan_url_en
                by_scan[scan_key] = row

            variants = {v.variant_type: v for v in row.variants}
            for variant_type, urls in slot.variants.items():
                variant = variants.get(variant_type)
                if variant is None:
                    variant = m.CardCatalogVariant(variant_type=variant_type)
                    row.variants.append(variant)
                    # Before prints had rows, the standard scan's URL was
                    # only on the card.
                    old = (
                        previous_source_url if variant_type == "standard" else None,
                        None,
                    )
                else:
                    old = (variant.source_url_en, variant.source_url_fr)
                if _url_changed(old, urls):
                    _redownload(row, variant, slot)
                    redownloads += 1
                elif variant.no_scan and any(
                    new and not before
                    for before, new in zip(old, (urls["en"], urls["fr"]))
                ):
                    # A new URL may have a scan: ask the CDN again.
                    variant.no_scan = False
                variant.source_url_en = urls["en"]
                variant.source_url_fr = urls["fr"]
            cards_upserted += 1

        sets_processed += 1
        db.flush()

    db.commit()
    # name.txt may have changed with the source.
    display._series_names_fr.cache_clear()
    logger.info(
        "import_html: %d set(s), %d card(s) upserted, %d print(s) to download "
        "again (scan URL changed)",
        sets_processed,
        cards_upserted,
        redownloads,
    )
    return {"sets_processed": sets_processed, "cards_upserted": cards_upserted}
