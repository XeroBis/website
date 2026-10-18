"""`/api/cards/decks`: normal decks (owned copies, under the deck limits) and
phantom decks (want-lists of catalog cards), their cards, poster cards,
history, copy, export/import and the text exports. Every change to a deck
writes `deck_history` in the same transaction (deck_rules.py)."""

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, exists, func, select, tuple_
from sqlalchemy.orm import Session, selectinload

from core.database import get_db
from core.models import User
from domains.cards import deck_rules, decklists, display
from domains.cards import models as m
from domains.cards import schemas as s
from domains.cards.access import cards_user, is_cards_user, not_found, owned

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/decks", tags=["cards"])

ExportMode = Literal["full", "missing", "not_available"]


def invalid(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def owned_deck(db: Session, deck_id: int, user_id: int) -> m.Deck:
    return owned(db, m.Deck, deck_id, user_id, "Deck")


def _deck_name(db: Session, user_id: int, name: str, current: str | None = None):
    """A trimmed, non-blank name no other deck of the user has."""
    name = name.strip()
    if not name:
        raise invalid("A deck name is required")
    if name != current and db.scalar(
        select(exists().where(m.Deck.user_id == user_id, m.Deck.name == name))
    ):
        raise deck_rules.refused(f'A deck named "{name}" already exists')
    return name


def _with_cards(query):
    """Load what DeckCardOut and the deck rules need, in batched queries."""
    return query.options(
        selectinload(m.DeckCard.card).selectinload(m.Card.catalog_card),
        selectinload(m.DeckCard.card).selectinload(m.Card.variant_quantities),
        selectinload(m.DeckCard.catalog_card),
    )


def deck_rows(db: Session, deck_id: int) -> list[m.DeckCard]:
    return db.scalars(
        _with_cards(select(m.DeckCard))
        .where(m.DeckCard.deck_id == deck_id)
        .order_by(m.DeckCard.id)
    ).all()


def catalog_card_of(row: m.DeckCard) -> m.CardCatalog:
    return row.card.catalog_card if row.card_id is not None else row.catalog_card


# ── output ───────────────────────────────────────────────────────────────────


def _holding_decks(db: Session, card_ids) -> dict[tuple[int, str], list[s.DeckUsage]]:
    """(owned card, print) → the normal decks holding copies of it."""
    if not card_ids:
        return {}
    rows = db.execute(
        select(
            m.DeckCard.card_id,
            m.DeckCard.variant_type,
            m.Deck.id,
            m.Deck.name,
            func.sum(m.DeckCard.quantity_in_deck),
        )
        .join(m.Deck, m.Deck.id == m.DeckCard.deck_id)
        .where(m.DeckCard.card_id.in_(card_ids))
        .group_by(m.DeckCard.card_id, m.DeckCard.variant_type, m.Deck.id)
        .order_by(m.Deck.name)
    )
    result: dict[tuple[int, str], list[s.DeckUsage]] = {}
    for card_id, variant, deck_id, deck_name, copies in rows:
        result.setdefault((card_id, variant), []).append(
            s.DeckUsage(deck_id=deck_id, deck_name=deck_name, quantity_in_deck=copies)
        )
    return result


def deck_cards_out(
    db: Session, user_id: int, rows: list[m.DeckCard], language: str | None
) -> list[s.DeckCardOut]:
    """DeckCardOut for rows of any of the user's decks (loaded with
    _with_cards), with availability for all of them in three queries."""
    wanted = deck_rules.owned_cards(
        db, user_id, {row.catalog_id for row in rows if row.card_id is None}
    )
    allocated = deck_rules.allocated_by_print(
        db,
        {row.card_id for row in rows if row.card_id is not None}
        | {card.id for card in wanted.values()},
    )
    holders = _holding_decks(db, [card.id for card in wanted.values()])
    result = []
    for row in rows:
        variant = row.variant_type
        owned_count = None
        decks: list[s.DeckUsage] = []
        if row.card_id is not None:
            card = row.card
            available = deck_rules.owned_quantity(card, variant) - allocated.get(
                (card.id, variant), 0
            )
        else:
            card = wanted.get(row.catalog_id)
            owned_count = deck_rules.owned_quantity(card, variant)
            in_decks = allocated.get((card.id, variant), 0) if card else 0
            available = max(owned_count - in_decks, 0)
            decks = holders.get((card.id, variant), []) if card else []
        catalog = catalog_card_of(row)
        result.append(
            s.DeckCardOut(
                id=row.id,
                card_id=row.card_id,
                catalog_id=catalog.id,
                variant_type=variant,
                quantity_in_deck=row.quantity_in_deck,
                poster_slot=row.poster_slot,
                name=display.card_name(catalog, language),
                set_name=display.set_name(
                    catalog.set_name, catalog.set_name_fr, language
                ),
                set_code=catalog.set_code,
                card_number=catalog.card_number,
                image_path=display.image_path(catalog, language),
                supertype=catalog.supertype,
                available=available,
                owned=owned_count,
                allocated_decks=decks,
            )
        )
    return result


def decks_out(
    db: Session, user: User, decks: list[m.Deck], cards: bool = False
) -> list[s.DeckOut] | list[s.DeckDetailOut]:
    """DeckOut (DeckDetailOut with `cards`) for some of the user's decks:
    totals and poster cards (or every card) in a few batched queries."""
    ids = [deck.id for deck in decks]
    totals = dict(
        db.execute(
            select(m.DeckCard.deck_id, func.sum(m.DeckCard.quantity_in_deck))
            .where(m.DeckCard.deck_id.in_(ids))
            .group_by(m.DeckCard.deck_id)
        ).all()
    )
    query = _with_cards(select(m.DeckCard)).where(m.DeckCard.deck_id.in_(ids))
    if not cards:
        query = query.where(m.DeckCard.poster_slot.isnot(None))
    rows = db.scalars(query.order_by(m.DeckCard.id)).all()
    by_deck: dict[int, list[s.DeckCardOut]] = {}
    for row, out in zip(
        rows, deck_cards_out(db, user.id, rows, user.language), strict=True
    ):
        by_deck.setdefault(row.deck_id, []).append(out)

    result = []
    for deck in decks:
        deck_cards = by_deck.get(deck.id, [])
        fields = {
            "id": deck.id,
            "name": deck.name,
            "description": deck.description,
            "deck_type": deck.deck_type,
            "has_wdc_cards": deck.has_wdc_cards,
            "created_at": deck.created_at,
            "total_cards": totals.get(deck.id, 0),
            "poster_cards": sorted(
                (c for c in deck_cards if c.poster_slot is not None),
                key=lambda c: c.poster_slot,
            ),
        }
        result.append(
            s.DeckDetailOut(**fields, cards=deck_cards)
            if cards
            else s.DeckOut(**fields)
        )
    return result


def deck_detail(db: Session, user: User, deck: m.Deck) -> s.DeckDetailOut:
    return decks_out(db, user, [deck], cards=True)[0]


# ── filling a deck from the catalog ──────────────────────────────────────────


def add_catalog_cards(
    db: Session,
    user_id: int,
    deck: m.Deck,
    items: list[tuple[m.CardCatalog, str, int]],
) -> None:
    """Add `(catalog card, print, copies)` on top of the deck's cards (repeats
    add up). A phantom deck takes them as is; a normal deck needs each card
    owned and follows the deck limits (409 naming the card)."""
    merged: dict[tuple[int, str], tuple[m.CardCatalog, int]] = {}
    for card, variant, copies in items:
        previous = merged.get((card.id, variant), (card, 0))[1]
        merged[(card.id, variant)] = (card, previous + copies)
    if deck.deck_type == "phantom":
        current = {
            (row.catalog_id, row.variant_type): row.quantity_in_deck
            for row in db.scalars(
                select(m.DeckCard).where(m.DeckCard.deck_id == deck.id)
            )
        }
        deck_rules.set_wanted_quantities(
            db,
            deck,
            [
                (card, variant, current.get((catalog_id, variant), 0) + copies)
                for (catalog_id, variant), (card, copies) in merged.items()
            ],
        )
        return
    cards = deck_rules.owned_cards(db, user_id, {cid for cid, _ in merged})
    additions = []
    for (catalog_id, variant), (catalog_card, copies) in merged.items():
        card = cards.get(catalog_id)
        if card is None:
            raise deck_rules.refused(f'"{catalog_card.name}" is not in your collection')
        additions.append((card, variant, copies))
    deck_rules.add_owned_cards(db, deck, additions)


def _pasted_cards(db: Session, text: str) -> list[tuple[m.CardCatalog, str, int]]:
    """The matched lines of a pasted decklist, as standard prints (a
    decklist says nothing about prints)."""
    return [
        (card, "standard", copies)
        for card, copies in decklists.matched_cards(db, text).values()
    ]


# ── list, create, delete all ─────────────────────────────────────────────────


@router.get("", response_model=list[s.DeckOut])
def list_decks(user: User = Depends(cards_user), db: Session = Depends(get_db)):
    """The user's decks by name, with totals and poster cards."""
    decks = db.scalars(
        select(m.Deck).where(m.Deck.user_id == user.id).order_by(m.Deck.name)
    ).all()
    return decks_out(db, user, decks)


@router.post("", response_model=s.DeckOut, status_code=status.HTTP_201_CREATED)
def create_deck(
    body: s.DeckCreate, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """A new empty deck, or one filled from a pasted decklist (matched lines
    only, standard print; normal decks under the deck limits, all or
    nothing)."""
    deck = m.Deck(
        user_id=user.id,
        name=_deck_name(db, user.id, body.name),
        description=(body.description or "").strip() or None,
        deck_type=body.deck_type,
    )
    db.add(deck)
    db.flush()
    deck_rules.log_deck_history(db, deck.id, "created", deck.name)
    if body.decklist_text:
        add_catalog_cards(db, user.id, deck, _pasted_cards(db, body.decklist_text))
    db.commit()
    return decks_out(db, user, [deck])[0]


@router.delete("", response_model=s.DeckWipeResult)
def delete_all_decks(user: User = Depends(cards_user), db: Session = Depends(get_db)):
    """Delete every deck of the user (cards, history and drafts follow);
    combats that used them keep their snapshots. The collection is
    untouched."""
    deleted = db.execute(delete(m.Deck).where(m.Deck.user_id == user.id)).rowcount
    db.commit()
    logger.warning("cards decks wiped (user %s): %d decks", user.id, deleted)
    return s.DeckWipeResult(deleted_decks=deleted)


@router.get("/combat-options", response_model=list[s.CombatDeckOption])
def combat_deck_options(_: User = Depends(cards_user), db: Session = Depends(get_db)):
    """Every cards user's normal decks, for the combat deck pickers: name,
    tag and owner only, never their cards. By name, then owner."""
    rows = db.execute(
        select(m.Deck, User)
        .join(User, User.id == m.Deck.user_id)
        .where(m.Deck.deck_type == "normal", is_cards_user())
        .order_by(func.lower(m.Deck.name), func.lower(User.pseudo), m.Deck.id)
    ).all()
    return [
        s.CombatDeckOption(
            id=deck.id,
            name=deck.name,
            deck_type=deck.deck_type,
            has_wdc_cards=deck.has_wdc_cards,
            owner_id=owner.id,
            owner_label=owner.pseudo,
        )
        for deck, owner in rows
    ]


# ── export / import ──────────────────────────────────────────────────────────


def _export_quantities(
    db: Session, user_id: int, deck: m.Deck, rows: list[m.DeckCard], mode: ExportMode
) -> list[tuple[m.DeckCard, int]]:
    """Each row with the copies to export. `mode` only filters a phantom
    deck: `missing` keeps the shortfall against owned copies of the print,
    `not_available` against copies outside normal decks."""
    if deck.deck_type != "phantom" or mode == "full":
        return [(row, row.quantity_in_deck) for row in rows]
    counts = deck_rules.availability(
        db, user_id, {(row.catalog_id, row.variant_type) for row in rows}
    )
    kept = []
    for row in rows:
        owned_count, available = counts[(row.catalog_id, row.variant_type)]
        have = owned_count if mode == "missing" else available
        if have < row.quantity_in_deck:
            kept.append((row, row.quantity_in_deck - have))
    return kept


def _deck_file(
    deck: m.Deck, rows: list[tuple[m.DeckCard, int]], drafts: list[m.DeckUpgradeDraft]
) -> s.DeckFile:
    """English names; cards by set code and number."""
    return s.DeckFile(
        name=deck.name,
        description=deck.description,
        deck_type=deck.deck_type,
        cards=[
            s.DeckFileCard(
                name=catalog_card_of(row).name,
                set_code=catalog_card_of(row).set_code,
                card_number=catalog_card_of(row).card_number,
                variant_type=row.variant_type,
                quantity_in_deck=copies,
            )
            for row, copies in rows
        ],
        drafts=[
            s.DeckFileDraft(
                name=draft.name,
                entries=[
                    s.DeckFileDraftEntry(
                        name=entry.catalog_card.name,
                        set_code=entry.catalog_card.set_code,
                        card_number=entry.catalog_card.card_number,
                        variant_type=entry.variant_type,
                        quantity_delta=entry.quantity_delta,
                    )
                    for entry in sorted(draft.entries, key=lambda e: e.id)
                ],
            )
            for draft in sorted(drafts, key=lambda d: d.name)
        ],
    )


def _with_drafts(query):
    return query.options(
        selectinload(m.Deck.upgrade_drafts)
        .selectinload(m.DeckUpgradeDraft.entries)
        .selectinload(m.DeckUpgradeDraftCard.catalog_card)
    )


@router.get("/export", response_model=s.DecksFile)
def export_all_decks(user: User = Depends(cards_user), db: Session = Depends(get_db)):
    """`decks.json`: every deck by name, with its drafts."""
    decks = db.scalars(
        _with_drafts(select(m.Deck))
        .where(m.Deck.user_id == user.id)
        .order_by(m.Deck.name)
    ).all()
    rows: dict[int, list[m.DeckCard]] = {}
    for row in db.scalars(
        _with_cards(select(m.DeckCard))
        .where(m.DeckCard.deck_id.in_([deck.id for deck in decks]))
        .order_by(m.DeckCard.id)
    ):
        rows.setdefault(row.deck_id, []).append(row)
    return s.DecksFile(
        decks=[
            _deck_file(
                deck,
                [(row, row.quantity_in_deck) for row in rows.get(deck.id, [])],
                deck.upgrade_drafts,
            )
            for deck in decks
        ]
    )


def _catalog_by_number(
    db: Session, files: list[s.DeckFile]
) -> dict[tuple[str, str], m.CardCatalog]:
    """(set code, number) → catalog card for every card a file names, in one
    query (a repeated number keeps the lowest id)."""
    pairs = {
        (item.set_code, item.card_number)
        for file in files
        for item in [
            *file.cards,
            *(entry for draft in file.drafts or [] for entry in draft.entries),
        ]
    }
    if not pairs:
        return {}
    found: dict[tuple[str, str], m.CardCatalog] = {}
    for card in db.scalars(
        select(m.CardCatalog)
        .where(tuple_(m.CardCatalog.set_code, m.CardCatalog.card_number).in_(pairs))
        .options(selectinload(m.CardCatalog.variants))
        .order_by(m.CardCatalog.id)
    ):
        found.setdefault((card.set_code, card.card_number), card)
    return found


def _import_deck(
    db: Session,
    user: User,
    file: s.DeckFile,
    catalog: dict[tuple[str, str], m.CardCatalog],
) -> m.Deck:
    """Create one deck (and its drafts) from a deck file, or raise: 409 for a
    taken name, an unowned card, a deck limit or a draft result outside
    0–4; 422 for an unknown card or print, or drafts on a phantom deck."""
    where = f' (deck "{file.name}")'

    def resolve(item) -> m.CardCatalog:
        card = catalog.get((item.set_code, item.card_number))
        label = item.name or f"{item.set_code} {item.card_number}"
        if card is None:
            raise invalid(f'Unknown card "{label}": not in the catalog{where}')
        if item.variant_type not in {v.variant_type for v in card.variants}:
            raise invalid(f'"{label}" has no "{item.variant_type}" print{where}')
        return card

    deck_type = "phantom" if file.deck_type == "phantom" else "normal"
    name = _deck_name(db, user.id, file.name)
    items = [(resolve(c), c.variant_type, c.quantity_in_deck) for c in file.cards]
    if file.drafts and deck_type != "normal":
        raise invalid(f"Only normal decks can have upgrade drafts{where}")
    if len({draft.name.strip() for draft in file.drafts or []}) != len(
        file.drafts or []
    ):
        raise invalid(f"Two drafts have the same name{where}")
    drafts = []
    for draft in file.drafts or []:
        deltas: dict[tuple[int, str], tuple[m.CardCatalog, int]] = {}
        for entry in draft.entries:
            card = resolve(entry)
            previous = deltas.get((card.id, entry.variant_type), (card, 0))[1]
            deltas[(card.id, entry.variant_type)] = (
                card,
                previous + entry.quantity_delta,
            )
        drafts.append((draft.name.strip(), deltas))

    deck = m.Deck(
        user_id=user.id,
        name=name,
        description=(file.description or "").strip() or None,
        deck_type=deck_type,
    )
    db.add(deck)
    db.flush()
    deck_rules.log_deck_history(db, deck.id, "created", deck.name)
    add_catalog_cards(db, user.id, deck, items)

    baseline: dict[tuple[int, str], int] = {}
    for card, variant, copies in items:
        baseline[(card.id, variant)] = baseline.get((card.id, variant), 0) + copies
    for draft_name, deltas in drafts:
        draft = m.DeckUpgradeDraft(deck_id=deck.id, name=draft_name)
        for (catalog_id, variant), (card, delta) in deltas.items():
            if delta == 0:
                continue
            check_result(card, baseline.get((catalog_id, variant), 0), delta)
            draft.entries.append(
                m.DeckUpgradeDraftCard(
                    catalog_id=catalog_id, variant_type=variant, quantity_delta=delta
                )
            )
        db.add(draft)
    db.flush()
    return deck


def check_result(card: m.CardCatalog, baseline: int, delta: int) -> None:
    """A draft line's result (deck quantity + delta) stays within 0–4
    (Basic Energy unlimited), else 409."""
    result = baseline + delta
    if result < 0:
        raise deck_rules.refused(
            f'Can\'t remove more copies of "{card.name}" than the {baseline} '
            "in the deck"
        )
    if result > deck_rules.MAX_COPIES_PER_CARD and not deck_rules.is_basic_energy(
        card.name
    ):
        raise deck_rules.refused(
            f'Max {deck_rules.MAX_COPIES_PER_CARD} copies of "{card.name}" per deck'
        )


def _rejected(user: User, what: str, error: HTTPException) -> HTTPException:
    logger.warning("cards %s import (user %s): %s", what, user.id, error.detail)
    return error


@router.post("/import", response_model=s.DeckOut, status_code=status.HTTP_201_CREATED)
def import_deck(
    body: s.DeckFile, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """A deck file as a new deck, all or nothing. Cards are matched by set
    code and number, then (normal decks) to the owned copies."""
    try:
        deck = _import_deck(db, user, body, _catalog_by_number(db, [body]))
    except HTTPException as error:
        raise _rejected(user, "deck", error) from None
    db.commit()
    return decks_out(db, user, [deck])[0]


@router.post(
    "/import-all",
    response_model=list[s.DeckOut],
    status_code=status.HTTP_201_CREATED,
)
def import_all_decks(
    body: s.DecksFile, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """`decks.json`, all or nothing: one new deck per entry, in file order;
    decks of the same file share the available copies."""
    try:
        if not body.decks:
            raise invalid("The file has no decks")
        names = [deck.name.strip() for deck in body.decks]
        if len(set(names)) != len(names):
            raise invalid("Two decks of the file have the same name")
        catalog = _catalog_by_number(db, body.decks)
        decks = [_import_deck(db, user, file, catalog) for file in body.decks]
    except HTTPException as error:
        raise _rejected(user, "decks", error) from None
    db.commit()
    return decks_out(db, user, decks)


# ── one deck ─────────────────────────────────────────────────────────────────


@router.get("/{deck_id}", response_model=s.DeckDetailOut)
def get_deck(
    deck_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    return deck_detail(db, user, owned_deck(db, deck_id, user.id))


@router.put("/{deck_id}", response_model=s.DeckOut)
def update_deck(
    deck_id: int,
    body: s.DeckUpdate,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Rename, change the description, pick the poster cards (deck card ids
    in slot order). Only the fields sent change."""
    deck = owned_deck(db, deck_id, user.id)
    if body.name is not None:
        name = _deck_name(db, user.id, body.name, current=deck.name)
        if name != deck.name:
            deck_rules.log_deck_history(db, deck.id, "renamed", None, deck.name, name)
            deck.name = name
    if "description" in body.model_fields_set:
        description = (body.description or "").strip() or None
        if description != deck.description:
            deck_rules.log_deck_history(
                db, deck.id, "description_changed", None, deck.description, description
            )
            deck.description = description
    if body.poster_card_ids is not None:
        poster_ids = body.poster_card_ids
        if len(set(poster_ids)) != len(poster_ids):
            raise invalid("Poster cards must be different cards")
        rows = {
            row.id: row
            for row in db.scalars(
                select(m.DeckCard).where(m.DeckCard.deck_id == deck.id)
            )
        }
        if any(row_id not in rows for row_id in poster_ids):
            raise invalid("A poster card is not in this deck")
        # Clear first: the slots are unique per deck while rows swap them.
        for row in rows.values():
            row.poster_slot = None
        db.flush()
        for slot, row_id in enumerate(poster_ids):
            rows[row_id].poster_slot = slot
    db.commit()
    return decks_out(db, user, [deck])[0]


@router.delete("/{deck_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_deck(
    deck_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """Its cards, history and drafts follow; combats keep their snapshots."""
    deck = owned_deck(db, deck_id, user.id)
    db.execute(delete(m.Deck).where(m.Deck.id == deck.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{deck_id}/history", response_model=s.DeckHistoryPage)
def deck_history(
    deck_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Every change to the deck, newest first."""
    deck = owned_deck(db, deck_id, user.id)
    history = m.DeckHistory
    total = db.scalar(
        select(func.count()).select_from(history).where(history.deck_id == deck.id)
    )
    items = db.scalars(
        select(history)
        .where(history.deck_id == deck.id)
        .order_by(history.created_at.desc(), history.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return s.DeckHistoryPage(
        total=total,
        page=page,
        page_size=page_size,
        items=[s.DeckHistoryOut.model_validate(entry) for entry in items],
    )


@router.post(
    "/{deck_id}/copy", response_model=s.DeckOut, status_code=status.HTTP_201_CREATED
)
def copy_deck(
    deck_id: int,
    body: s.DeckCopy,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """A new deck of the same type with the same description and cards, all
    or nothing: a normal deck's copies must be available a second time."""
    source = owned_deck(db, deck_id, user.id)
    deck = m.Deck(
        user_id=user.id,
        name=_deck_name(db, user.id, body.name),
        description=source.description,
        deck_type=source.deck_type,
    )
    db.add(deck)
    db.flush()
    deck_rules.log_deck_history(db, deck.id, "copied", f'Copied from "{source.name}"')
    rows = deck_rows(db, source.id)
    if source.deck_type == "phantom":
        deck_rules.set_wanted_quantities(
            db,
            deck,
            [
                (row.catalog_card, row.variant_type, row.quantity_in_deck)
                for row in rows
            ],
        )
    else:
        deck_rules.set_owned_quantities(
            db,
            deck,
            [(row.card, row.variant_type, row.quantity_in_deck) for row in rows],
        )
    db.commit()
    return decks_out(db, user, [deck])[0]


@router.get("/{deck_id}/export", response_model=s.DeckFile)
def export_deck(
    deck_id: int,
    mode: ExportMode = "full",
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """The deck file (English names, cards by set code and number, drafts
    included). A phantom deck can export only what's `missing` or
    `not_available` instead."""
    deck = db.scalar(_with_drafts(select(m.Deck)).where(m.Deck.id == deck_id))
    if deck is None or deck.user_id != user.id:
        raise not_found("Deck")
    rows = _export_quantities(db, user.id, deck, deck_rows(db, deck.id), mode)
    return _deck_file(deck, rows, deck.upgrade_drafts)


@router.get("/{deck_id}/export/text", response_class=Response)
def export_deck_text(
    deck_id: int,
    format: decklists.Format,
    mode: ExportMode = "full",
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """The deck as a TCGplayer/PTCGL or Cardmarket decklist (English), same
    rendering as the converter; `mode` as in the JSON export."""
    deck = owned_deck(db, deck_id, user.id)
    rows = _export_quantities(db, user.id, deck, deck_rows(db, deck.id), mode)
    entries = [decklists.entry(catalog_card_of(row), copies) for row, copies in rows]
    return Response(decklists.render(entries, format), media_type="text/plain")


# ── a deck's cards ───────────────────────────────────────────────────────────


def _check_print(card: m.CardCatalog, variant: str) -> None:
    if variant not in {v.variant_type for v in card.variants}:
        raise invalid(f'"{variant}" is not a print of this card')


def _deck_card(db: Session, deck: m.Deck, deck_card_id: int) -> m.DeckCard:
    row = db.scalar(
        _with_cards(select(m.DeckCard)).where(m.DeckCard.id == deck_card_id)
    )
    if row is None or row.deck_id != deck.id:
        raise not_found("Deck card")
    return row


def _row_out(db: Session, user: User, row: m.DeckCard) -> s.DeckCardOut:
    row = db.scalar(_with_cards(select(m.DeckCard)).where(m.DeckCard.id == row.id))
    return deck_cards_out(db, user.id, [row], user.language)[0]


@router.post(
    "/{deck_id}/cards",
    response_model=s.DeckCardOut,
    status_code=status.HTTP_201_CREATED,
)
def add_deck_card(
    deck_id: int,
    body: s.DeckCardCreate,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Put a print into the deck: an owned card (`card_id`) under the deck
    limits in a normal deck, any catalog card (`catalog_id`) in a phantom
    one. A print already in the deck is changed with PUT instead."""
    deck = owned_deck(db, deck_id, user.id)
    variant = body.variant_type
    if deck.deck_type == "phantom":
        if body.catalog_id is None or body.card_id is not None:
            raise invalid("A phantom deck takes a catalog_id")
        catalog_card = db.get(m.CardCatalog, body.catalog_id)
        if catalog_card is None:
            raise not_found("Card")
        _check_print(catalog_card, variant)
        key = (m.DeckCard.catalog_id == catalog_card.id,)
    else:
        if body.card_id is None or body.catalog_id is not None:
            raise invalid("A normal deck takes an owned card_id")
        card = owned(db, m.Card, body.card_id, user.id, "Card")
        _check_print(card.catalog_card, variant)
        key = (m.DeckCard.card_id == card.id,)
    if db.scalar(
        select(
            exists().where(
                m.DeckCard.deck_id == deck.id, m.DeckCard.variant_type == variant, *key
            )
        )
    ):
        raise deck_rules.refused("This print is already in the deck")
    if deck.deck_type == "phantom":
        deck_rules.set_wanted_quantities(
            db, deck, [(catalog_card, variant, body.quantity_in_deck)]
        )
    else:
        deck_rules.set_owned_quantities(
            db, deck, [(card, variant, body.quantity_in_deck)]
        )
    row = db.scalar(
        select(m.DeckCard).where(
            m.DeckCard.deck_id == deck.id, m.DeckCard.variant_type == variant, *key
        )
    )
    db.commit()
    return _row_out(db, user, row)


@router.post(
    "/{deck_id}/cards/bulk",
    response_model=s.DeckDetailOut,
    status_code=status.HTTP_201_CREATED,
)
def bulk_add_deck_cards(
    deck_id: int,
    body: s.DeckBulkAdd,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Add owned cards to a normal deck at once (the Collection staging
    list), all or nothing; a print already there is raised."""
    deck = owned_deck(db, deck_id, user.id)
    if deck.deck_type == "phantom":
        raise invalid("A phantom deck is filled from a decklist")
    card_ids = {item.card_id for item in body.items}
    cards = {
        card.id: card
        for card in db.scalars(
            select(m.Card)
            .where(m.Card.id.in_(card_ids), m.Card.user_id == user.id)
            .options(
                selectinload(m.Card.catalog_card).selectinload(m.CardCatalog.variants),
                selectinload(m.Card.variant_quantities),
            )
        )
    }
    if len(cards) != len(card_ids):
        raise not_found("Card")
    merged: dict[tuple[int, str], int] = {}
    for item in body.items:
        card = cards[item.card_id]
        prints = [v.variant_type for v in card.catalog_card.variants]
        if not item.all_variants:
            _check_print(card.catalog_card, item.variant_type)
            prints = [item.variant_type]
        for variant in prints:
            key = (card.id, variant)
            merged[key] = merged.get(key, 0) + item.quantity_in_deck
    deck_rules.add_owned_cards(
        db,
        deck,
        [
            (cards[card_id], variant, copies)
            for (card_id, variant), copies in merged.items()
        ],
    )
    db.commit()
    return deck_detail(db, user, deck)


@router.post(
    "/{deck_id}/cards/from-paste",
    response_model=s.DeckDetailOut,
    status_code=status.HTTP_201_CREATED,
)
def paste_deck_cards(
    deck_id: int,
    body: s.DecklistText,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Add a pasted decklist's matched cards (standard print) on top of the
    deck's; a normal deck needs them owned and follows the limits, all or
    nothing."""
    deck = owned_deck(db, deck_id, user.id)
    items = _pasted_cards(db, body.decklist_text)
    if not items:
        raise invalid("No cards could be matched in the pasted text")
    add_catalog_cards(db, user.id, deck, items)
    db.commit()
    return deck_detail(db, user, deck)


@router.put("/{deck_id}/cards/{deck_card_id}", response_model=s.DeckCardOut)
def set_deck_card_quantity(
    deck_id: int,
    deck_card_id: int,
    body: s.DeckCardUpdate,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Set the copies of one row (a phantom row: the wanted count, no
    limits)."""
    deck = owned_deck(db, deck_id, user.id)
    row = _deck_card(db, deck, deck_card_id)
    _set_row(db, deck, row, body.quantity_in_deck)
    db.commit()
    return _row_out(db, user, row)


@router.delete(
    "/{deck_id}/cards/{deck_card_id}", status_code=status.HTTP_204_NO_CONTENT
)
def remove_deck_card(
    deck_id: int,
    deck_card_id: int,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Take a row out of the deck, freeing its copies and poster slot."""
    deck = owned_deck(db, deck_id, user.id)
    _set_row(db, deck, _deck_card(db, deck, deck_card_id), 0)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _set_row(db: Session, deck: m.Deck, row: m.DeckCard, quantity: int) -> None:
    if row.card_id is None:
        deck_rules.set_wanted_quantities(
            db, deck, [(row.catalog_card, row.variant_type, quantity)]
        )
    else:
        deck_rules.set_owned_quantities(
            db, deck, [(row.card, row.variant_type, quantity)]
        )
