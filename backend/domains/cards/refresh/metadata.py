"""The catalog metadata export/import (`cards_metadata.json`): every catalog
card with its prints' scan paths, in the old app's format. The import merges
by (set_code, card_number), keeping row ids (so collections and decks keep
pointing at the same cards) and every card or print the file doesn't list."""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from domains.cards import models as m
from domains.cards import schemas as s
from domains.cards.variant_order import ALL_VARIANT_TYPES

_COPIED_FIELDS = (
    "set_name",
    "set_name_fr",
    "set_code",
    "card_number",
    "supertype",
    "rarity",
    "series",
    "card_count",
    "release_date",
    "image_path_fr",
)


def _invalid(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, detail)


def export_catalog(db: Session) -> s.CatalogFile:
    rows = db.scalars(
        select(m.CardCatalog)
        .options(selectinload(m.CardCatalog.variants))
        .order_by(m.CardCatalog.id)
    ).all()
    return s.CatalogFile(
        total_cards=len(rows),
        cards=[
            s.CatalogFileCard(
                pokemon_name=row.name,
                display_name=row.display_name,
                details=row.details,
                local_path=row.image_path,
                card_page_url=row.source_url,
                variants=[s.CatalogVariantOut.model_validate(v) for v in row.variants],
                **{f: getattr(row, f) for f in _COPIED_FIELDS},
            )
            for row in rows
        ],
    )


def _check_file(body: s.CatalogFile) -> None:
    if not body.cards:
        raise _invalid("The file has no cards")
    if body.total_cards != len(body.cards):
        raise _invalid("total_cards does not match the cards")
    identities, paths = set(), set()
    for card in body.cards:
        identity = (card.set_code, card.card_number)
        if any(
            not value.strip()
            for value in (card.pokemon_name, card.set_name, *identity, card.local_path)
        ):
            raise _invalid(
                "Card names, set names, set codes, numbers and paths must not be empty"
            )
        if identity in identities or card.local_path in paths:
            raise _invalid(
                f"{card.set_code} {card.card_number} or its image path is in the file twice"
            )
        identities.add(identity)
        paths.add(card.local_path)
        variants = [v.variant_type for v in card.variants]
        if len(variants) != len(set(variants)) or any(
            v not in ALL_VARIANT_TYPES for v in variants
        ):
            raise _invalid(
                f"{card.set_code} {card.card_number}: unknown or repeated print"
            )


def import_catalog(db: Session, body: s.CatalogFile) -> s.CatalogImportResult:
    """All or nothing. An old file without `display_name` keeps the French
    names already stored (new cards get the English one)."""
    _check_file(body)
    rows = db.scalars(
        select(m.CardCatalog).options(selectinload(m.CardCatalog.variants))
    ).all()
    wanted = {(c.set_code, c.card_number) for c in body.cards}
    by_identity: dict[tuple[str, str], m.CardCatalog] = {}
    for row in rows:
        identity = (row.set_code, row.card_number)
        if identity in by_identity and identity in wanted:
            raise _conflict(
                f"{row.set_code} {row.card_number} matches several catalog cards"
            )
        by_identity[identity] = row
    by_path = {row.image_path: row for row in rows}

    created = updated = 0
    for card in body.cards:
        row = by_identity.get((card.set_code, card.card_number))
        owner = by_path.get(card.local_path)
        if owner is not None and owner is not row:
            raise _conflict(
                f"{card.set_code} {card.card_number}: its image path belongs to another catalog card"
            )
        if row is None:
            row = m.CardCatalog(display_name=card.pokemon_name)
            db.add(row)
            created += 1
        else:
            updated += 1
        row.name = card.pokemon_name
        if "details" in card.model_fields_set:
            row.details = card.details
        if "display_name" in card.model_fields_set:
            row.display_name = card.display_name or card.pokemon_name
        row.image_path = card.local_path
        row.source_url = card.card_page_url
        for f in _COPIED_FIELDS:
            setattr(row, f, getattr(card, f))
        variants = {v.variant_type: v for v in row.variants}
        for variant in card.variants:
            target = variants.get(variant.variant_type)
            if target is None:
                target = m.CardCatalogVariant(variant_type=variant.variant_type)
                row.variants.append(target)
            target.image_path_fr = variant.image_path_fr
            target.image_path_us = variant.image_path_us
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _conflict("The file conflicts with the catalog's image paths") from exc
    return s.CatalogImportResult(created=created, updated=updated)
