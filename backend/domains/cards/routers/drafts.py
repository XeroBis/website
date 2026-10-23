"""Upgrade drafts: named "what if" diffs against a normal deck
(`/api/cards/decks/{deck_id}/drafts`), applied all or nothing, and the
shopping-list exports of what they still need, alone or several pooled
together (`/api/cards/drafts`).

Every proposed addition keeps one owned copy back for the binder: the
`available` shown per line, `can_apply`, applying and the `reserve_singles`
export all count it.
"""

import json
from typing import Literal

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import delete, exists, func, select, tuple_
from sqlalchemy.orm import Session, selectinload

from core.database import get_db
from core.models import User
from domains.cards import deck_rules, decklists, display
from domains.cards import models as m
from domains.cards import schemas as s
from domains.cards.access import cards_user, not_found
from domains.cards.routers.decks import (
    check_result,
    deck_cards_out,
    deck_detail,
    deck_rows,
    invalid,
    owned_deck,
)

router = APIRouter(tags=["cards"])

ExportMode = Literal["full", "missing", "not_available", "reserve_singles"]
BINDER_COPIES = 1


def _normal_deck(db: Session, deck_id: int, user_id: int) -> m.Deck:
    deck = owned_deck(db, deck_id, user_id)
    if deck.deck_type != "normal":
        raise invalid("Only normal decks have upgrade drafts")
    return deck


def _draft(db: Session, deck: m.Deck, draft_id: int) -> m.DeckUpgradeDraft:
    draft = db.get(m.DeckUpgradeDraft, draft_id)
    if draft is None or draft.deck_id != deck.id:
        raise not_found("Draft")
    return draft


def _draft_name(
    db: Session, deck: m.Deck, name: str, current: str | None = None
) -> str:
    name = name.strip()
    if not name:
        raise invalid("A draft name is required")
    if name != current and db.scalar(
        select(
            exists().where(
                m.DeckUpgradeDraft.deck_id == deck.id, m.DeckUpgradeDraft.name == name
            )
        )
    ):
        raise deck_rules.refused(f'A draft named "{name}" already exists')
    return name


def _entries(db: Session, draft_ids) -> list[m.DeckUpgradeDraftCard]:
    return db.scalars(
        select(m.DeckUpgradeDraftCard)
        .where(m.DeckUpgradeDraftCard.draft_id.in_(draft_ids))
        .options(selectinload(m.DeckUpgradeDraftCard.catalog_card))
        .order_by(m.DeckUpgradeDraftCard.id)
    ).all()


def _touch(draft: m.DeckUpgradeDraft) -> None:
    draft.updated_at = func.now()


# ── output ───────────────────────────────────────────────────────────────────


def _draft_detail(
    db: Session, user: User, deck: m.Deck, draft: m.DeckUpgradeDraft
) -> s.DraftDetailOut:
    rows = deck_rows(db, deck.id)
    entries = _entries(db, [draft.id])
    language = user.language
    baseline = {
        (row.card.catalog_id, row.variant_type): row.quantity_in_deck for row in rows
    }
    counts = deck_rules.availability(
        db, user.id, {(e.catalog_id, e.variant_type) for e in entries}
    )

    def shown(card: m.CardCatalog) -> dict:
        return {
            "catalog_id": card.id,
            "name": display.card_name(card, language),
            "set_name": display.set_name(card.set_name, card.set_name_fr, language),
            "image_path": display.image_path(card, language),
            "supertype": card.supertype,
        }

    entry_outs = []
    for entry in entries:
        key = (entry.catalog_id, entry.variant_type)
        owned_count, available = counts[key]
        entry_outs.append(
            s.DraftEntryOut(
                **shown(entry.catalog_card),
                variant_type=entry.variant_type,
                baseline_quantity=baseline.get(key, 0),
                quantity_delta=entry.quantity_delta,
                result_quantity=baseline.get(key, 0) + entry.quantity_delta,
                owned=owned_count,
                available=max(available - BINDER_COPIES, 0),
            )
        )

    deltas = {(e.catalog_id, e.variant_type): e.quantity_delta for e in entries}
    cards = {row.card.catalog_id: row.card.catalog_card for row in rows}
    cards |= {e.catalog_id: e.catalog_card for e in entries}
    result_cards = []
    for key in dict.fromkeys([*baseline, *deltas]):
        quantity = baseline.get(key, 0) + deltas.get(key, 0)
        if quantity > 0:
            result_cards.append(
                s.DraftResultCard(
                    **shown(cards[key[0]]),
                    variant_type=key[1],
                    quantity_in_deck=quantity,
                )
            )
    result_total = sum(baseline.values()) + sum(deltas.values())
    return s.DraftDetailOut(
        id=draft.id,
        deck_id=deck.id,
        name=draft.name,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
        current_cards=deck_cards_out(db, user.id, rows, language),
        entries=entry_outs,
        result_cards=result_cards,
        result_total=result_total,
        can_apply=bool(entries)
        and result_total <= deck_rules.MAX_DECK_SIZE
        and all(e.quantity_delta <= e.available for e in entry_outs),
    )


def _draft_out(db: Session, draft: m.DeckUpgradeDraft) -> s.DraftOut:
    count = db.scalar(
        select(func.count()).where(m.DeckUpgradeDraftCard.draft_id == draft.id)
    )
    return s.DraftOut(
        id=draft.id,
        deck_id=draft.deck_id,
        name=draft.name,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
        entry_count=count,
    )


# ── diffing a target decklist ────────────────────────────────────────────────


def _target(db: Session, text: str) -> decklists.Tally:
    """(catalog id, print) → (card, copies) from a pasted decklist, or else
    from a deck file's JSON (its `cards`, matched by set code and number).
    Lines or cards that don't match are dropped."""
    totals = decklists.matched_cards(db, text)
    if totals:
        return totals
    try:
        file = s.DeckFile.model_validate(json.loads(text))
    except ValueError:  # bad JSON, or not a deck file
        return {}
    pairs = {(c.set_code, c.card_number) for c in file.cards}
    if not pairs:
        return {}
    catalog: dict[tuple[str, str], m.CardCatalog] = {}
    for card in db.scalars(
        select(m.CardCatalog)
        .where(tuple_(m.CardCatalog.set_code, m.CardCatalog.card_number).in_(pairs))
        .order_by(m.CardCatalog.id)
    ):
        catalog.setdefault((card.set_code, card.card_number), card)
    for item in file.cards:
        card = catalog.get((item.set_code, item.card_number))
        if card is not None and item.variant_type in {
            v.variant_type for v in card.variants
        }:
            key = (card.id, item.variant_type)
            previous = totals.get(key, (card, 0))[1]
            totals[key] = (card, previous + item.quantity_in_deck)
    return totals


Change = tuple[m.CardCatalog, str, int]


def _diff(db: Session, deck: m.Deck, text: str) -> list[Change]:
    """The signed changes, per print, turning the deck into the target list,
    each card's result (over its prints) checked to stay within 0–4.
    Unchanged prints are left out."""
    target = _target(db, text)
    if not target:
        raise invalid("No cards could be matched in the pasted text")
    current: decklists.Tally = {
        (row.card.catalog_id, row.variant_type): (
            row.card.catalog_card,
            row.quantity_in_deck,
        )
        for row in deck_rows(db, deck.id)
    }
    changes = []
    wanted_per_card: dict[int, tuple[m.CardCatalog, int]] = {}
    for (catalog_id, variant), (card, _) in (current | target).items():
        baseline = current.get((catalog_id, variant), (card, 0))[1]
        wanted = target.get((catalog_id, variant), (card, 0))[1]
        total = wanted_per_card.get(catalog_id, (card, 0))[1] + wanted
        wanted_per_card[catalog_id] = (card, total)
        if wanted != baseline:
            changes.append((card, variant, wanted - baseline))
    for card, wanted in wanted_per_card.values():
        check_result(card, 0, wanted)
    return changes


def _replace_entries(
    db: Session, draft: m.DeckUpgradeDraft, changes: list[Change]
) -> None:
    db.execute(
        delete(m.DeckUpgradeDraftCard).where(
            m.DeckUpgradeDraftCard.draft_id == draft.id
        )
    )
    for card, variant, delta in changes:
        db.add(
            m.DeckUpgradeDraftCard(
                draft_id=draft.id,
                catalog_id=card.id,
                variant_type=variant,
                quantity_delta=delta,
            )
        )
    _touch(draft)


# ── one deck's drafts ────────────────────────────────────────────────────────

DRAFTS = "/decks/{deck_id}/drafts"


@router.get(DRAFTS, response_model=list[s.DraftOut])
def list_drafts(
    deck_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """The deck's drafts, last changed first."""
    deck = _normal_deck(db, deck_id, user.id)
    entry_count = (
        select(func.count())
        .where(m.DeckUpgradeDraftCard.draft_id == m.DeckUpgradeDraft.id)
        .scalar_subquery()
    )
    rows = db.execute(
        select(m.DeckUpgradeDraft, entry_count)
        .where(m.DeckUpgradeDraft.deck_id == deck.id)
        .order_by(m.DeckUpgradeDraft.updated_at.desc(), m.DeckUpgradeDraft.id.desc())
    ).all()
    return [
        s.DraftOut(
            id=draft.id,
            deck_id=draft.deck_id,
            name=draft.name,
            created_at=draft.created_at,
            updated_at=draft.updated_at,
            entry_count=count,
        )
        for draft, count in rows
    ]


@router.post(
    DRAFTS, response_model=s.DraftDetailOut, status_code=status.HTTP_201_CREATED
)
def create_draft(
    deck_id: int,
    body: s.DraftCreate,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """An empty draft, or the diff against a pasted decklist / deck file."""
    deck = _normal_deck(db, deck_id, user.id)
    draft = m.DeckUpgradeDraft(deck_id=deck.id, name=_draft_name(db, deck, body.name))
    changes = _diff(db, deck, body.decklist_text) if body.decklist_text else []
    db.add(draft)
    db.flush()
    _replace_entries(db, draft, changes)
    db.commit()
    return _draft_detail(db, user, deck, draft)


@router.get(DRAFTS + "/{draft_id}", response_model=s.DraftDetailOut)
def get_draft(
    deck_id: int,
    draft_id: int,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    deck = _normal_deck(db, deck_id, user.id)
    return _draft_detail(db, user, deck, _draft(db, deck, draft_id))


@router.put(DRAFTS + "/{draft_id}", response_model=s.DraftOut)
def rename_draft(
    deck_id: int,
    draft_id: int,
    body: s.DraftRename,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    deck = _normal_deck(db, deck_id, user.id)
    draft = _draft(db, deck, draft_id)
    draft.name = _draft_name(db, deck, body.name, current=draft.name)
    db.commit()
    return _draft_out(db, draft)


@router.delete(DRAFTS + "/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(
    deck_id: int,
    draft_id: int,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    deck = _normal_deck(db, deck_id, user.id)
    db.delete(_draft(db, deck, draft_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(DRAFTS + "/{draft_id}/paste", response_model=s.DraftDetailOut)
def paste_draft(
    deck_id: int,
    draft_id: int,
    body: s.DecklistText,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Replace the draft's lines with the diff against a pasted decklist or
    deck file."""
    deck = _normal_deck(db, deck_id, user.id)
    draft = _draft(db, deck, draft_id)
    _replace_entries(db, draft, _diff(db, deck, body.decklist_text))
    db.commit()
    return _draft_detail(db, user, deck, draft)


@router.put(
    DRAFTS + "/{draft_id}/entries/{catalog_id}", response_model=s.DraftDetailOut
)
def set_draft_entry(
    deck_id: int,
    draft_id: int,
    catalog_id: int,
    body: s.DraftEntryUpdate,
    variant_type: str = "standard",
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Propose a signed change to one print of a card (any catalog card),
    replacing the draft's line for it; the result must stay within 0–4."""
    deck = _normal_deck(db, deck_id, user.id)
    draft = _draft(db, deck, draft_id)
    card = db.get(m.CardCatalog, catalog_id)
    if card is None:
        raise not_found("Card")
    if variant_type not in {v.variant_type for v in card.variants}:
        raise invalid(f'"{variant_type}" is not a print of this card')
    baseline = next(
        (
            row.quantity_in_deck
            for row in deck_rows(db, deck.id)
            if row.card.catalog_id == catalog_id and row.variant_type == variant_type
        ),
        0,
    )
    check_result(card, baseline, body.quantity_delta)
    entry = db.scalar(
        select(m.DeckUpgradeDraftCard).where(
            m.DeckUpgradeDraftCard.draft_id == draft.id,
            m.DeckUpgradeDraftCard.catalog_id == catalog_id,
            m.DeckUpgradeDraftCard.variant_type == variant_type,
        )
    )
    if entry is None:
        entry = m.DeckUpgradeDraftCard(
            draft_id=draft.id, catalog_id=catalog_id, variant_type=variant_type
        )
        db.add(entry)
    entry.quantity_delta = body.quantity_delta
    _touch(draft)
    db.commit()
    return _draft_detail(db, user, deck, draft)


@router.delete(
    DRAFTS + "/{draft_id}/entries/{catalog_id}", response_model=s.DraftDetailOut
)
def remove_draft_entry(
    deck_id: int,
    draft_id: int,
    catalog_id: int,
    variant_type: str = "standard",
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    deck = _normal_deck(db, deck_id, user.id)
    draft = _draft(db, deck, draft_id)
    removed = db.execute(
        delete(m.DeckUpgradeDraftCard).where(
            m.DeckUpgradeDraftCard.draft_id == draft.id,
            m.DeckUpgradeDraftCard.catalog_id == catalog_id,
            m.DeckUpgradeDraftCard.variant_type == variant_type,
        )
    ).rowcount
    if not removed:
        raise not_found("Draft entry")
    _touch(draft)
    db.commit()
    return _draft_detail(db, user, deck, draft)


@router.post(DRAFTS + "/{draft_id}/apply", response_model=s.DeckDetailOut)
def apply_draft(
    deck_id: int,
    draft_id: int,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Apply every line to the deck as it is now, all or nothing, under the
    deck limits (an addition also keeps the binder copy back); each change
    is logged and the draft is deleted. On a refusal (409 naming the card)
    nothing changes."""
    deck = _normal_deck(db, deck_id, user.id)
    draft = _draft(db, deck, draft_id)
    entries = _entries(db, [draft.id])
    if not entries:
        raise deck_rules.refused("This draft has no changes")
    current = {
        (row.card.catalog_id, row.variant_type): row.quantity_in_deck
        for row in deck_rows(db, deck.id)
    }
    cards = deck_rules.owned_cards(db, user.id, {e.catalog_id for e in entries})
    targets = []
    for entry in entries:
        name = entry.catalog_card.name
        old = current.get((entry.catalog_id, entry.variant_type), 0)
        if old + entry.quantity_delta < 0:
            raise deck_rules.refused(
                f'The draft is out of date: the deck has {old} copies of "{name}" '
                f"({entry.variant_type})"
            )
        card = cards.get(entry.catalog_id)
        if card is None:
            raise deck_rules.refused(f'"{name}" is not in your collection')
        targets.append((card, entry.variant_type, old + entry.quantity_delta))
    deck_rules.set_owned_quantities(db, deck, targets, reserve=BINDER_COPIES)
    db.delete(draft)
    db.commit()
    return deck_detail(db, user, deck)


# ── shopping-list exports ────────────────────────────────────────────────────


def _still_needed(
    db: Session,
    user_id: int,
    entries: list[m.DeckUpgradeDraftCard],
    mode: ExportMode,
) -> list[Change]:
    """Proposed additions summed per (card, print) over `entries`, then cut
    down by `mode` once against the pooled demand (so one owned copy never
    covers two drafts): `full` all of it, `missing` minus owned copies,
    `not_available` minus copies outside normal decks, `reserve_singles`
    the same minus one more (the binder copy). Removals are never listed."""
    pooled: dict[tuple[int, str], tuple[m.CardCatalog, int]] = {}
    for entry in entries:
        if entry.quantity_delta > 0:
            key = (entry.catalog_id, entry.variant_type)
            previous = pooled.get(key, (entry.catalog_card, 0))[1]
            pooled[key] = (entry.catalog_card, previous + entry.quantity_delta)
    if mode == "full":
        return [(card, key[1], wanted) for key, (card, wanted) in pooled.items()]
    counts = deck_rules.availability(db, user_id, set(pooled))
    needed = []
    for key, (card, wanted) in pooled.items():
        owned_count, available = counts[key]
        have = {
            "missing": owned_count,
            "not_available": available,
            "reserve_singles": max(available - BINDER_COPIES, 0),
        }[mode]
        if have < wanted:
            needed.append((card, key[1], wanted - have))
    return needed


@router.get(DRAFTS + "/{draft_id}/export/text", response_class=Response)
def export_draft_text(
    deck_id: int,
    draft_id: int,
    format: decklists.Format,
    mode: ExportMode,
    include_sets: bool = True,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """What the draft still needs, as a TCGplayer/PTCGL or Cardmarket list
    (English)."""
    deck = _normal_deck(db, deck_id, user.id)
    draft = _draft(db, deck, draft_id)
    needed = _still_needed(db, user.id, _entries(db, [draft.id]), mode)
    entries = [
        decklists.entry(card, copies, variant_type=variant)
        for card, variant, copies in needed
    ]
    return Response(
        decklists.render(entries, format, include_sets), media_type="text/plain"
    )


@router.get("/drafts", response_model=list[s.DraftPickerItem])
def list_all_drafts(user: User = Depends(cards_user), db: Session = Depends(get_db)):
    """Every draft of the user's normal decks, last changed first, with the
    deck's card count once applied (the combined export picker)."""
    drafts = db.scalars(
        select(m.DeckUpgradeDraft)
        .join(m.DeckUpgradeDraft.deck)
        .where(m.Deck.user_id == user.id, m.Deck.deck_type == "normal")
        .options(
            selectinload(m.DeckUpgradeDraft.deck),
            selectinload(m.DeckUpgradeDraft.entries),
        )
        .order_by(m.DeckUpgradeDraft.updated_at.desc(), m.DeckUpgradeDraft.id.desc())
    ).all()
    totals = dict(
        db.execute(
            select(m.DeckCard.deck_id, func.sum(m.DeckCard.quantity_in_deck))
            .where(m.DeckCard.deck_id.in_({d.deck_id for d in drafts}))
            .group_by(m.DeckCard.deck_id)
        ).all()
    )
    return [
        s.DraftPickerItem(
            id=draft.id,
            deck_id=draft.deck_id,
            deck_name=draft.deck.name,
            name=draft.name,
            updated_at=draft.updated_at,
            result_total=totals.get(draft.deck_id, 0)
            + sum(e.quantity_delta for e in draft.entries),
        )
        for draft in drafts
    ]


@router.post("/drafts/export/text", response_class=Response)
def export_drafts_text(
    body: s.DraftIds,
    format: decklists.Format,
    mode: ExportMode,
    include_sets: bool = True,
    language: Literal["en", "fr"] = "en",
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """What several drafts (of any of the user's decks) still need together,
    demand pooled per card before comparing with owned copies. `language`
    picks the card names (moves and sets stay English)."""
    ids = set(body.draft_ids)
    found = db.scalar(
        select(func.count())
        .select_from(m.DeckUpgradeDraft)
        .join(m.DeckUpgradeDraft.deck)
        .where(m.DeckUpgradeDraft.id.in_(ids), m.Deck.user_id == user.id)
    )
    if found != len(ids):
        raise not_found("Draft")
    needed = _still_needed(db, user.id, _entries(db, ids), mode)
    entries = [
        decklists.entry(card, copies, language, variant)
        for card, variant, copies in needed
    ]
    return Response(
        decklists.render(entries, format, include_sets), media_type="text/plain"
    )
