"""`/api/cards/collection`: the user's owned cards (a quantity per print),
search and filter options, adding (also straight into a deck), quantity
edits, deletion, history, export/import and the full reset. Every ownership
change writes `collection_history` in the same transaction."""

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, exists, func, or_, select
from sqlalchemy.orm import Session, contains_eager, selectinload

from core.database import get_db
from core.models import User
from domains.cards import deck_rules, display, search
from domains.cards import models as m
from domains.cards import schemas as s
from domains.cards.access import cards_user, not_found, owned
from domains.cards.variant_order import variant_sort_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/collection", tags=["cards"])


def _invalid(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


# ── ownership changes ────────────────────────────────────────────────────────


def _log(db, user_id, catalog_id, variant_type, action, source, old, new) -> None:
    db.add(
        m.CollectionHistory(
            user_id=user_id,
            catalog_id=catalog_id,
            variant_type=variant_type,
            action=action,
            source=source,
            old_quantity=old,
            new_quantity=new,
        )
    )


def _quantity(card: m.Card, variant_type: str) -> int:
    return next(
        (
            vq.quantity
            for vq in card.variant_quantities
            if vq.variant_type == variant_type
        ),
        0,
    )


def _set_quantity(
    db: Session, card: m.Card, variant_type: str, quantity: int, source: str
) -> None:
    """Set the copies owned of one print (0 removes it) and log the change.
    The caller deletes a card left without prints."""
    row = next(
        (vq for vq in card.variant_quantities if vq.variant_type == variant_type), None
    )
    old = row.quantity if row else 0
    if quantity == old:
        return
    if quantity == 0:
        card.variant_quantities.remove(row)
        action = "removed"
    elif row is None:
        card.variant_quantities.append(
            m.CardVariantQuantity(variant_type=variant_type, quantity=quantity)
        )
        action = "added"
    else:
        row.quantity = quantity
        action = "increased" if quantity > old else "decreased"
    _log(
        db,
        card.user_id,
        card.catalog_id,
        variant_type,
        action,
        source,
        old or None,
        quantity or None,
    )


def _with_details(query):
    """Load what CardOut needs in batched queries."""
    return query.options(
        selectinload(m.Card.catalog_card).selectinload(m.CardCatalog.variants),
        selectinload(m.Card.variant_quantities),
    )


def _cards_for(
    db: Session, user_id: int, catalog_cards: dict[int, m.CardCatalog]
) -> dict[int, m.Card]:
    """The user's card row for each catalog card, by catalog id, creating the
    missing ones (one row per catalog card and user)."""
    cards = {
        card.catalog_id: card
        for card in db.scalars(
            _with_details(select(m.Card)).where(
                m.Card.user_id == user_id, m.Card.catalog_id.in_(catalog_cards)
            )
        )
    }
    for catalog_id, catalog_card in catalog_cards.items():
        if catalog_id not in cards:
            card = m.Card(
                user_id=user_id,
                catalog_id=catalog_id,
                catalog_card=catalog_card,
                variant_quantities=[],
            )
            db.add(card)
            cards[catalog_id] = card
    return cards


def _prints_to_add(catalog_card: m.CardCatalog, item: s.CardAdd) -> list[str]:
    prints = [v.variant_type for v in catalog_card.variants]
    if item.all_variants:
        return prints
    if item.variant_type not in prints:
        raise _invalid(f'"{item.variant_type}" is not a print of this card')
    return [item.variant_type]


# ── output ───────────────────────────────────────────────────────────────────


def _cards_out(
    db: Session, cards: list[m.Card], language: str | None
) -> list[s.CardOut]:
    """CardOut for each card, with allocations and decks for all of them in
    two grouped queries. `cards` need their details loaded (_with_details)."""
    ids = [card.id for card in cards]
    allocated: dict[int, dict[str, int]] = {}
    for (card_id, variant), copies in deck_rules.allocated_by_print(db, ids).items():
        allocated.setdefault(card_id, {})[variant] = copies
    decks: dict[int, list[s.DeckUsage]] = {}
    if ids:
        rows = db.execute(
            select(
                m.DeckCard.card_id,
                m.Deck.id,
                m.Deck.name,
                func.sum(m.DeckCard.quantity_in_deck),
            )
            .join(m.Deck, m.Deck.id == m.DeckCard.deck_id)
            .where(m.DeckCard.card_id.in_(ids))
            .group_by(m.DeckCard.card_id, m.Deck.id)
            .order_by(m.Deck.name)
        )
        for card_id, deck_id, deck_name, copies in rows:
            decks.setdefault(card_id, []).append(
                s.DeckUsage(
                    deck_id=deck_id, deck_name=deck_name, quantity_in_deck=copies
                )
            )

    result = []
    for card in cards:
        catalog = card.catalog_card
        scans = {v.variant_type: v for v in catalog.variants}
        quantity = sum(vq.quantity for vq in card.variant_quantities)
        by_print = allocated.get(card.id, {})
        result.append(
            s.CardOut(
                id=card.id,
                catalog_id=card.catalog_id,
                variants=[
                    s.OwnedVariantOut(
                        variant_type=vq.variant_type,
                        quantity=vq.quantity,
                        image_path_fr=getattr(
                            scans.get(vq.variant_type), "image_path_fr", None
                        ),
                        image_path_us=getattr(
                            scans.get(vq.variant_type), "image_path_us", None
                        ),
                    )
                    for vq in card.variant_quantities
                ],
                quantity=quantity,
                created_at=card.created_at,
                name=display.card_name(catalog, language),
                set_name=display.set_name(
                    catalog.set_name, catalog.set_name_fr, language
                ),
                set_code=catalog.set_code,
                card_number=catalog.card_number,
                image_path=display.image_path(catalog, language),
                supertype=catalog.supertype,
                rarity=catalog.rarity,
                series=catalog.series,
                card_count=catalog.card_count,
                release_date=catalog.release_date,
                allocated=sum(by_print.values()),
                allocated_variants=by_print,
                available=quantity - sum(by_print.values()),
                decks=decks.get(card.id, []),
            )
        )
    return result


def _reloaded(db: Session, cards: list[m.Card]) -> list[m.Card]:
    """The same cards after a commit, details reloaded in one go, same
    order."""
    ids = [card.id for card in cards]
    by_id = {
        card.id: card
        for card in db.scalars(_with_details(select(m.Card)).where(m.Card.id.in_(ids)))
    }
    return [by_id[card_id] for card_id in ids]


# ── read ─────────────────────────────────────────────────────────────────────


@router.get("", response_model=list[s.CardOut])
def list_cards(
    set_code: str | None = None,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """The whole collection (or one set's part of it), unpaginated, by set
    then number. The Collection page uses /search instead."""
    query = (
        select(m.Card)
        .join(m.Card.catalog_card)
        .where(m.Card.user_id == user.id)
        .options(
            contains_eager(m.Card.catalog_card).selectinload(m.CardCatalog.variants),
            selectinload(m.Card.variant_quantities),
        )
        .order_by(*search.order_by("set_name_asc", search.name_column(user.language)))
    )
    if set_code:
        query = query.where(m.CardCatalog.set_code == set_code)
    return _cards_out(db, db.scalars(query).all(), user.language)


@router.get("/filter-options", response_model=s.CollectionFilterOptions)
def collection_filter_options(
    user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """Sets, rarities and non-standard prints the user owns."""
    owned_catalog = select().select_from(m.Card).join(m.Card.catalog_card)
    owned_catalog = owned_catalog.where(m.Card.user_id == user.id)
    sets = db.execute(
        owned_catalog.add_columns(
            m.CardCatalog.set_code,
            m.CardCatalog.set_name,
            func.max(m.CardCatalog.set_name_fr).label("set_name_fr"),
        ).group_by(m.CardCatalog.set_code, m.CardCatalog.set_name)
    ).all()
    rarity = m.CardCatalog.rarity
    rarities = db.scalars(
        owned_catalog.add_columns(rarity)
        .where(rarity.isnot(None))
        .distinct()
        .order_by(rarity)
    ).all()
    variant = m.CardVariantQuantity.variant_type
    prints = db.scalars(
        select(variant)
        .distinct()
        .join(m.Card, m.Card.id == m.CardVariantQuantity.card_id)
        .where(m.Card.user_id == user.id, variant != "standard")
    ).all()
    set_options = [
        s.SetOption(
            set_code=row.set_code,
            set_name=display.set_name(row.set_name, row.set_name_fr, user.language),
        )
        for row in sets
    ]
    return s.CollectionFilterOptions(
        sets=sorted(set_options, key=lambda o: (o.set_name.lower(), o.set_code)),
        rarities=rarities,
        owned_variant_types=sorted(prints, key=variant_sort_key),
    )


@router.get("/search", response_model=s.CardPage)
def search_collection(
    search_term: str | None = Query(None, alias="search"),
    set_code: str | None = None,
    set_name: str | None = Query(None, description="Partial set name"),
    supertype: list[str] | None = Query(None),
    rarity: list[str] | None = Query(None, description="Raw rarity values"),
    card_number: str | None = Query(None, description="Partial card number"),
    variant_type: list[str] | None = Query(
        None, description="Cards owned in one of these prints"
    ),
    available: Literal["available", "unavailable"] | None = Query(
        None, description="Some copy outside decks, or none"
    ),
    sort: str = Query("name_asc", description=", ".join(search.SORT_OPTIONS)),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """The Collection page: the catalog browse's filters and sorts over the
    user's cards, plus availability and owned prints."""
    vq = m.CardVariantQuantity
    owned_copies = (
        select(vq.card_id, func.sum(vq.quantity).label("quantity"))
        .join(m.Card, m.Card.id == vq.card_id)
        .where(m.Card.user_id == user.id)
        .group_by(vq.card_id)
        .subquery()
    )
    in_decks = (
        select(
            m.DeckCard.card_id,
            func.sum(m.DeckCard.quantity_in_deck).label("allocated"),
        )
        .join(m.Card, m.Card.id == m.DeckCard.card_id)
        .where(m.Card.user_id == user.id)
        .group_by(m.DeckCard.card_id)
        .subquery()
    )
    conditions = [
        m.Card.user_id == user.id,
        *search.card_filters(
            search_term, set_code, set_name, supertype, rarity, card_number
        ),
    ]
    if variant_type:
        conditions.append(
            m.Card.variant_quantities.any(vq.variant_type.in_(variant_type))
        )
    if available:
        spare = owned_copies.c.quantity - func.coalesce(in_decks.c.allocated, 0)
        conditions.append(spare > 0 if available == "available" else spare <= 0)

    def filtered(*columns):
        # owned_copies and in_decks have one row per card, so the joins add
        # no duplicates for the window sums to count twice.
        return (
            select(*columns)
            .select_from(m.Card)
            .join(m.Card.catalog_card)
            .join(owned_copies, owned_copies.c.card_id == m.Card.id)
            .outerjoin(in_decks, in_decks.c.card_id == m.Card.id)
            .where(*conditions)
        )

    rows = db.execute(
        filtered(
            m.Card,
            func.count().over().label("total"),
            func.sum(owned_copies.c.quantity).over().label("total_quantity"),
        )
        .options(
            contains_eager(m.Card.catalog_card).selectinload(m.CardCatalog.variants),
            selectinload(m.Card.variant_quantities),
        )
        .order_by(*search.order_by(sort, search.name_column(user.language)))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    if rows:
        total, total_quantity = rows[0].total, rows[0].total_quantity
    else:
        total, total_quantity = db.execute(
            filtered(func.count(), func.coalesce(func.sum(owned_copies.c.quantity), 0))
        ).one()
    collection_total = db.scalar(
        select(func.coalesce(func.sum(vq.quantity), 0))
        .join(m.Card, m.Card.id == vq.card_id)
        .where(m.Card.user_id == user.id)
    )
    return s.CardPage(
        total=total,
        page=page,
        page_size=page_size,
        total_quantity=total_quantity,
        collection_total_quantity=collection_total,
        items=_cards_out(db, [row[0] for row in rows], user.language),
    )


@router.get("/history", response_model=s.CollectionHistoryPage)
def collection_history(
    search_term: str | None = Query(None, alias="search"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Every ownership change, newest first; `search` matches the card name
    like the catalog search."""
    history = m.CollectionHistory
    conditions = [history.user_id == user.id]
    if search_term:
        conditions.append(search.name_filter(search_term))
    query = (
        select(history, m.CardCatalog)
        .join(m.CardCatalog, m.CardCatalog.id == history.catalog_id)
        .where(*conditions)
    )
    rows = db.execute(
        query.add_columns(func.count().over().label("total"))
        .order_by(history.created_at.desc(), history.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    if rows:
        total = rows[0].total
    else:
        total = db.scalar(
            select(func.count())
            .select_from(history)
            .join(m.CardCatalog, m.CardCatalog.id == history.catalog_id)
            .where(*conditions)
        )
    language = user.language
    return s.CollectionHistoryPage(
        total=total,
        page=page,
        page_size=page_size,
        items=[
            s.CollectionHistoryOut(
                id=entry.id,
                catalog_id=entry.catalog_id,
                variant_type=entry.variant_type,
                action=entry.action,
                source=entry.source,
                old_quantity=entry.old_quantity,
                new_quantity=entry.new_quantity,
                created_at=entry.created_at,
                name=display.card_name(card, language),
                set_name=display.set_name(card.set_name, card.set_name_fr, language),
                image_path=display.image_path(card, language),
            )
            for entry, card, _ in rows
        ],
    )


# ── export / import ──────────────────────────────────────────────────────────


@router.get("/export", response_model=s.CollectionFile)
def export_collection(user: User = Depends(cards_user), db: Session = Depends(get_db)):
    """`collection.json`: every owned card with its prints, English values,
    by set then number."""
    cards = db.scalars(
        select(m.Card)
        .join(m.Card.catalog_card)
        .where(m.Card.user_id == user.id)
        .options(
            contains_eager(m.Card.catalog_card),
            selectinload(m.Card.variant_quantities),
        )
        .order_by(*search.order_by("set_name_asc", m.CardCatalog.name))
    ).all()
    return s.CollectionFile(
        cards=[
            s.CollectionFileCard(
                name=card.catalog_card.name,
                set_name=card.catalog_card.set_name,
                set_code=card.catalog_card.set_code,
                card_number=card.catalog_card.card_number,
                image_path=card.catalog_card.image_path,
                variants=[
                    s.VariantQuantity(
                        variant_type=vq.variant_type, quantity=vq.quantity
                    )
                    for vq in card.variant_quantities
                ],
            )
            for card in cards
        ]
    )


@router.post("/import", response_model=s.CollectionImportResult)
def import_collection(
    body: s.CollectionFile,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Import `collection.json`, all or nothing. Each card is matched by
    `image_path`; each listed print's quantity replaces the owned one (prints
    not listed are kept). Refused, naming the card, when a card isn't in the
    catalog, a print doesn't exist for it, or a quantity would drop below
    what decks use."""

    def rejected(error: HTTPException) -> HTTPException:
        logger.warning("cards collection import (user %s): %s", user.id, error.detail)
        return error

    if not body.cards:
        raise rejected(_invalid("The file has no cards"))
    catalog = {
        card.image_path: card
        for card in db.scalars(
            select(m.CardCatalog)
            .where(m.CardCatalog.image_path.in_({c.image_path for c in body.cards}))
            .options(selectinload(m.CardCatalog.variants))
        )
    }
    # Per catalog card, per print, the quantity to set (a repeat wins).
    wanted: dict[int, dict[str, int]] = {}
    for entry in body.cards:
        label = entry.name or entry.image_path
        catalog_card = catalog.get(entry.image_path)
        if catalog_card is None:
            raise rejected(_invalid(f'Unknown card "{label}": not in the catalog'))
        prints = {v.variant_type for v in catalog_card.variants}
        for variant in entry.variants:
            if variant.variant_type not in prints:
                raise rejected(
                    _invalid(f'"{label}" has no "{variant.variant_type}" print')
                )
            wanted.setdefault(catalog_card.id, {})[
                variant.variant_type
            ] = variant.quantity

    catalog_by_id = {card.id: card for card in catalog.values() if card.id in wanted}
    cards = _cards_for(db, user.id, catalog_by_id)
    allocated = deck_rules.allocated_by_print(
        db, [card.id for card in cards.values() if card.id is not None]
    )
    for catalog_id, quantities in wanted.items():
        card = cards[catalog_id]
        for variant, quantity in quantities.items():
            in_decks = allocated.get((card.id, variant), 0)
            if quantity < in_decks:
                raise rejected(
                    deck_rules.refused(
                        f'"{catalog_by_id[catalog_id].name}" ({variant}): '
                        f"{in_decks} copies are in decks"
                    )
                )
            _set_quantity(db, card, variant, quantity, "import")
    db.commit()
    return s.CollectionImportResult(
        imported=len(wanted),
        imported_quantity=sum(sum(q.values()) for q in wanted.values()),
    )


# ── add ──────────────────────────────────────────────────────────────────────


@router.post("", response_model=s.CardOut, status_code=status.HTTP_201_CREATED)
def add_card(
    body: s.CardAdd, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """Add copies of one print (or of every print) on top of what's owned."""
    catalog_card = db.get(m.CardCatalog, body.catalog_id)
    if catalog_card is None:
        raise not_found("Card")
    prints = _prints_to_add(catalog_card, body)
    card = _cards_for(db, user.id, {catalog_card.id: catalog_card})[catalog_card.id]
    for variant in prints:
        _set_quantity(
            db, card, variant, _quantity(card, variant) + body.quantity, "manual"
        )
    db.commit()
    return _cards_out(db, _reloaded(db, [card]), user.language)[0]


@router.post(
    "/bulk", response_model=list[s.CardOut], status_code=status.HTTP_201_CREATED
)
def bulk_add_cards(
    body: s.CardBulkAdd, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """Add several cards at once (the Browse staging list), all or nothing.
    A card or print queued twice adds up. With `deck_id` (a normal deck),
    every added copy also goes into that deck, under the deck limits, in the
    same transaction. Returns each card once, in queue order."""
    catalog_ids = list(dict.fromkeys(item.catalog_id for item in body.items))
    catalog = {
        card.id: card
        for card in db.scalars(
            select(m.CardCatalog)
            .where(m.CardCatalog.id.in_(catalog_ids))
            .options(selectinload(m.CardCatalog.variants))
        )
    }
    if len(catalog) != len(catalog_ids):
        raise not_found("Card")
    deck = None
    if body.deck_id is not None:
        deck = owned(db, m.Deck, body.deck_id, user.id, "Deck")
        if deck.deck_type == "phantom":
            raise _invalid("A phantom deck is filled from a decklist")

    added: dict[tuple[int, str], int] = {}
    for item in body.items:
        for variant in _prints_to_add(catalog[item.catalog_id], item):
            key = (item.catalog_id, variant)
            added[key] = added.get(key, 0) + item.quantity

    cards = _cards_for(db, user.id, catalog)
    for (catalog_id, variant), copies in added.items():
        card = cards[catalog_id]
        _set_quantity(db, card, variant, _quantity(card, variant) + copies, "manual")
    if deck is not None:
        db.flush()
        deck_rules.add_owned_cards(
            db,
            deck,
            [(cards[cid], variant, copies) for (cid, variant), copies in added.items()],
        )
    db.commit()
    result = _reloaded(db, [cards[catalog_id] for catalog_id in catalog_ids])
    return _cards_out(db, result, user.language)


# ── reset ────────────────────────────────────────────────────────────────────


@router.delete("", response_model=s.CollectionWipeResult)
def delete_all_cards(user: User = Depends(cards_user), db: Session = Depends(get_db)):
    """Wipe the user's collection and decks (with their cards, history and
    drafts), plus every combat that used one of those decks, whoever played
    it. Each print is logged as removed first. Other users' cards and decks
    are untouched."""
    cards = db.scalars(
        select(m.Card)
        .where(m.Card.user_id == user.id)
        .options(selectinload(m.Card.variant_quantities))
    ).all()
    for card in cards:
        for vq in card.variant_quantities:
            _log(
                db,
                user.id,
                card.catalog_id,
                vq.variant_type,
                "removed",
                "manual",
                vq.quantity,
                None,
            )
    deck_ids = select(m.Deck.id).where(m.Deck.user_id == user.id)
    deck_count = db.scalar(select(func.count()).select_from(deck_ids.subquery()))
    db.execute(
        delete(m.Combat).where(
            or_(m.Combat.deck_a_id.in_(deck_ids), m.Combat.deck_b_id.in_(deck_ids))
        )
    )
    # deck_cards, deck_history and drafts follow by ON DELETE CASCADE, and
    # the variant quantities with their cards.
    db.execute(delete(m.Deck).where(m.Deck.user_id == user.id))
    db.execute(delete(m.Card).where(m.Card.user_id == user.id))
    db.commit()
    logger.warning(
        "cards collection wiped (user %s): %d cards, %d decks",
        user.id,
        len(cards),
        deck_count,
    )
    return s.CollectionWipeResult(deleted_cards=len(cards), deleted_decks=deck_count)


# ── one card ─────────────────────────────────────────────────────────────────


def _owned_card(db: Session, card_id: int, user_id: int) -> m.Card:
    return owned(db, m.Card, card_id, user_id, "Card")


@router.get("/{card_id}", response_model=s.CardOut)
def get_card(
    card_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    card = _owned_card(db, card_id, user.id)
    return _cards_out(db, [card], user.language)[0]


@router.put("/{card_id}", response_model=s.CardOut | None)
def set_card_quantity(
    card_id: int,
    body: s.CardQuantityUpdate,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Set one print's quantity. Not below the copies of that print in decks;
    a positive quantity only for a print the card comes in. 0 removes the
    print; removing the last one deletes the card and returns null."""
    card = _owned_card(db, card_id, user.id)
    variant = body.variant_type
    if body.quantity > 0 and variant not in {
        v.variant_type for v in card.catalog_card.variants
    }:
        raise _invalid(f'"{variant}" is not a print of this card')
    in_decks = deck_rules.allocated_by_print(db, [card.id]).get((card.id, variant), 0)
    if body.quantity < in_decks:
        raise deck_rules.refused(
            f"{in_decks} copies of this print are in decks; remove them first"
        )
    _set_quantity(db, card, variant, body.quantity, "manual")
    if not card.variant_quantities:
        db.delete(card)
        db.commit()
        return None
    db.commit()
    return _cards_out(db, _reloaded(db, [card]), user.language)[0]


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_card(
    card_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """Remove a card and all its prints; refused while it is in a deck."""
    card = _owned_card(db, card_id, user.id)
    if db.scalar(select(exists().where(m.DeckCard.card_id == card.id))):
        raise deck_rules.refused(
            "The card is in a deck; remove it from every deck first"
        )
    for vq in card.variant_quantities:
        _log(
            db,
            user.id,
            card.catalog_id,
            vq.variant_type,
            "removed",
            "manual",
            vq.quantity,
            None,
        )
    db.delete(card)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
