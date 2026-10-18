"""Deck-building rules (data-model.md `cards` "Rules"), shared by the deck and
draft routes and the collection's "add to collection + deck" batch.

Normal decks' rows point at owned `cards` rows and follow the limits; phantom
rows point at the catalog and skip every limit. Every change to a deck's
cards goes through set_owned_quantities / set_wanted_quantities, which write
`deck_history` and refresh `has_wdc_cards`.
"""

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from domains.cards import models as m
from domains.cards.names import is_basic_energy

MAX_DECK_SIZE = 60
MAX_COPIES_PER_CARD = 4
WDC_SERIES = "World Championships"


def refused(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, detail)


def log_deck_history(
    db: Session,
    deck_id: int,
    action: str,
    detail: str | None = None,
    old_value: str | None = None,
    new_value: str | None = None,
    variant_type: str | None = None,
) -> None:
    db.add(
        m.DeckHistory(
            deck_id=deck_id,
            action=action,
            detail=detail,
            old_value=old_value,
            new_value=new_value,
            variant_type=variant_type,
        )
    )


# ── ownership and availability ───────────────────────────────────────────────


def owned_quantity(card: m.Card | None, variant_type: str) -> int:
    if card is None:
        return 0
    return next(
        (
            vq.quantity
            for vq in card.variant_quantities
            if vq.variant_type == variant_type
        ),
        0,
    )


def allocated_by_print(db: Session, card_ids) -> dict[tuple[int, str], int]:
    """Copies of each (owned card, print) allocated to normal decks, in one
    grouped query."""
    if not card_ids:
        return {}
    rows = db.execute(
        select(
            m.DeckCard.card_id,
            m.DeckCard.variant_type,
            func.sum(m.DeckCard.quantity_in_deck),
        )
        .where(m.DeckCard.card_id.in_(card_ids))
        .group_by(m.DeckCard.card_id, m.DeckCard.variant_type)
    ).all()
    return {(card_id, variant): total for card_id, variant, total in rows}


def owned_cards(db: Session, user_id: int, catalog_ids) -> dict[int, m.Card]:
    """The user's card rows for these catalog cards, by catalog id, with
    their prints and catalog card loaded."""
    if not catalog_ids:
        return {}
    return {
        card.catalog_id: card
        for card in db.scalars(
            select(m.Card)
            .where(m.Card.user_id == user_id, m.Card.catalog_id.in_(catalog_ids))
            .options(
                selectinload(m.Card.variant_quantities),
                selectinload(m.Card.catalog_card),
            )
        )
    }


def availability(
    db: Session, user_id: int, prints
) -> dict[tuple[int, str], tuple[int, int]]:
    """(catalog id, print) → (owned, available): copies the user owns of that
    print, and those not in a normal deck (never below 0). Two queries for
    the whole batch."""
    cards = owned_cards(db, user_id, {catalog_id for catalog_id, _ in prints})
    allocated = allocated_by_print(db, [card.id for card in cards.values()])
    result = {}
    for catalog_id, variant in prints:
        card = cards.get(catalog_id)
        owned = owned_quantity(card, variant)
        in_decks = allocated.get((card.id, variant), 0) if card else 0
        result[(catalog_id, variant)] = (owned, max(owned - in_decks, 0))
    return result


# ── changing a deck's cards ──────────────────────────────────────────────────


def set_owned_quantities(
    db: Session,
    deck: m.Deck,
    targets: list[tuple[m.Card, str, int]],
    reserve: int = 0,
) -> None:
    """Set the copies of each `(owned card, print)` in a normal deck (0
    removes the row), all or nothing: every limit is checked over the whole
    batch before anything is written (409 naming the card).

    - ≤ 4 copies per card over its prints (Basic Energy unlimited) and ≤ 60
      cards, checked when the change raises them;
    - a raised print needs that many spare copies (owned − in any normal
      deck), keeping `reserve` more back (the binder copy drafts keep).

    Each card must have `catalog_card` and `variant_quantities` loaded and a
    flushed id; each (card, print) appears once."""
    rows = {
        (row.card_id, row.variant_type): row
        for row in db.scalars(select(m.DeckCard).where(m.DeckCard.deck_id == deck.id))
    }
    before = {key: row.quantity_in_deck for key, row in rows.items()}
    after = before | {(card.id, variant): q for card, variant, q in targets}

    def per_card(quantities: dict[tuple[int, str], int]) -> dict[int, int]:
        totals: dict[int, int] = {}
        for (card_id, _), quantity in quantities.items():
            totals[card_id] = totals.get(card_id, 0) + quantity
        return totals

    card_before, card_after = per_card(before), per_card(after)
    allocated = allocated_by_print(db, {card.id for card, _, _ in targets})
    for card, variant, quantity in targets:
        name = card.catalog_card.name
        copies = card_after[card.id]
        if (
            copies > MAX_COPIES_PER_CARD
            and copies > card_before.get(card.id, 0)
            and not is_basic_energy(name)
        ):
            raise refused(f'Max {MAX_COPIES_PER_CARD} copies of "{name}" per deck')
        extra = quantity - before.get((card.id, variant), 0)
        spare = (
            owned_quantity(card, variant)
            - allocated.get((card.id, variant), 0)
            - reserve
        )
        if extra > 0 and extra > spare:
            raise refused(
                f'Only {max(spare, 0)} copies of "{name}" ({variant}) available'
            )
    total = sum(after.values())
    if total > MAX_DECK_SIZE and total > sum(before.values()):
        raise refused(f"A deck can't exceed {MAX_DECK_SIZE} cards")

    for card, variant, quantity in targets:
        row = rows.get((card.id, variant))
        if row is None and quantity:
            row = m.DeckCard(deck_id=deck.id, card=card, variant_type=variant)
            db.add(row)
        _write(db, deck, row, card.catalog_card.name, variant, quantity)
    recompute_has_wdc_cards(db, deck)


def add_owned_cards(
    db: Session, deck: m.Deck, additions: list[tuple[m.Card, str, int]]
) -> None:
    """Add `(owned card, print, copies)` on top of what a normal deck already
    holds, under set_owned_quantities' rules."""
    current = {
        (row.card_id, row.variant_type): row.quantity_in_deck
        for row in db.scalars(select(m.DeckCard).where(m.DeckCard.deck_id == deck.id))
    }
    set_owned_quantities(
        db,
        deck,
        [
            (card, variant, current.get((card.id, variant), 0) + copies)
            for card, variant, copies in additions
        ],
    )


def set_wanted_quantities(
    db: Session, deck: m.Deck, targets: list[tuple[m.CardCatalog, str, int]]
) -> None:
    """Set the wanted copies of each `(catalog card, print)` in a phantom
    deck (0 removes the row). No limits."""
    rows = {
        (row.catalog_id, row.variant_type): row
        for row in db.scalars(select(m.DeckCard).where(m.DeckCard.deck_id == deck.id))
    }
    for card, variant, quantity in targets:
        row = rows.get((card.id, variant))
        if row is None and quantity:
            row = m.DeckCard(deck_id=deck.id, catalog_id=card.id, variant_type=variant)
            db.add(row)
            rows[(card.id, variant)] = row
        _write(db, deck, row, card.name, variant, quantity)
    recompute_has_wdc_cards(db, deck)


def _write(
    db: Session,
    deck: m.Deck,
    row: m.DeckCard | None,
    name: str,
    variant: str,
    quantity: int,
) -> None:
    """Set one row's quantity and log it; a new row has no quantity yet."""
    old = row.quantity_in_deck if row is not None else None
    if row is None or old == quantity:
        return
    if quantity == 0:
        log_deck_history(db, deck.id, "card_removed", name, str(old), None, variant)
        db.delete(row)
        return
    if old is None:
        log_deck_history(db, deck.id, "card_added", name, None, str(quantity), variant)
    else:
        log_deck_history(
            db,
            deck.id,
            "card_quantity_changed",
            name,
            str(old),
            str(quantity),
            variant,
        )
    row.quantity_in_deck = quantity


def recompute_has_wdc_cards(db: Session, deck: m.Deck) -> None:
    """`has_wdc_cards`: some card of the deck (owned or wanted) is from a
    World Championships set. Call after the deck's cards change."""
    db.flush()
    wdc_rows = (
        select(m.DeckCard.id)
        .outerjoin(m.Card, m.Card.id == m.DeckCard.card_id)
        .join(
            m.CardCatalog,
            m.CardCatalog.id == func.coalesce(m.DeckCard.catalog_id, m.Card.catalog_id),
        )
        .where(m.DeckCard.deck_id == deck.id, m.CardCatalog.series == WDC_SERIES)
    )
    deck.has_wdc_cards = db.scalar(select(wdc_rows.exists()))
