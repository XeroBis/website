"""Deck-building rules (data-model.md `cards` "Rules"), shared by the deck
routes and the collection's "add to collection + deck" batch.

Normal decks only: their rows point at owned `cards` rows. Phantom rows
point at the catalog and skip every limit.
"""

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

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


def add_owned_cards(
    db: Session, deck: m.Deck, additions: list[tuple[m.Card, str, int]]
) -> None:
    """Add `(owned card, print, copies)` to a normal deck, all or nothing:
    every limit is checked over the whole batch before anything is written
    (409 naming the card). A print already in the deck has its quantity
    raised. Each `card` must have `catalog_card` and `variant_quantities`
    loaded and up to date."""
    rows = {
        (row.card_id, row.variant_type): row
        for row in db.scalars(select(m.DeckCard).where(m.DeckCard.deck_id == deck.id))
    }
    deck_total = sum(row.quantity_in_deck for row in rows.values())
    per_card: dict[int, int] = {}
    for (card_id, _), row in rows.items():
        per_card[card_id] = per_card.get(card_id, 0) + row.quantity_in_deck
    allocated = allocated_by_print(db, {card.id for card, _, _ in additions})

    for card, variant, copies in additions:
        name = card.catalog_card.name
        per_card[card.id] = per_card.get(card.id, 0) + copies
        if per_card[card.id] > MAX_COPIES_PER_CARD and not is_basic_energy(name):
            raise refused(f'Max {MAX_COPIES_PER_CARD} copies of "{name}" per deck')
        owned = next(
            (
                vq.quantity
                for vq in card.variant_quantities
                if vq.variant_type == variant
            ),
            0,
        )
        available = owned - allocated.get((card.id, variant), 0)
        if copies > available:
            raise refused(f'Only {available} copies of "{name}" ({variant}) available')
        allocated[(card.id, variant)] = allocated.get((card.id, variant), 0) + copies
        deck_total += copies
    if deck_total > MAX_DECK_SIZE:
        raise refused(f"A deck can't exceed {MAX_DECK_SIZE} cards")

    for card, variant, copies in additions:
        name = card.catalog_card.name
        row = rows.get((card.id, variant))
        if row is None:
            row = m.DeckCard(
                deck_id=deck.id, card=card, variant_type=variant, quantity_in_deck=0
            )
            db.add(row)
            rows[(card.id, variant)] = row
            log_deck_history(
                db, deck.id, "card_added", name, None, str(copies), variant
            )
        else:
            log_deck_history(
                db,
                deck.id,
                "card_quantity_changed",
                name,
                str(row.quantity_in_deck),
                str(row.quantity_in_deck + copies),
                variant,
            )
        row.quantity_in_deck += copies
    recompute_has_wdc_cards(db, deck)


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
