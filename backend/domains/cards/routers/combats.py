"""`/api/cards/combats`: the combat log, shared between cards users. Each
side's cards and deck name are frozen when its deck is set (snapshots), so a
combat survives its decks being edited or deleted. Any cards user may log,
edit or delete any combat; delete-all only removes the combats the user
played (every combat, for an admin)."""

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session, selectinload

from core.database import get_db
from core.models import User
from domains.cards import display
from domains.cards import models as m
from domains.cards import schemas as s
from domains.cards.access import cards_user, is_cards_user, not_found

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/combats", tags=["cards"])

SIDES = ("a", "b")


def invalid(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def _with_sides(query):
    return query.options(
        selectinload(m.Combat.deck_a).selectinload(m.Deck.owner),
        selectinload(m.Combat.deck_b).selectinload(m.Deck.owner),
        selectinload(m.Combat.player_a),
        selectinload(m.Combat.player_b),
    )


def _newest_first(query):
    return query.order_by(m.Combat.played_at.desc(), m.Combat.id.desc())


def snapshots(db: Session, deck_ids) -> dict[int, list[dict]]:
    """Each normal deck's cards as a combat snapshot (English values), in one
    query."""
    result: dict[int, list[dict]] = {deck_id: [] for deck_id in deck_ids}
    if not result:
        return result
    for row in db.scalars(
        select(m.DeckCard)
        .where(m.DeckCard.deck_id.in_(result))
        .options(selectinload(m.DeckCard.card).selectinload(m.Card.catalog_card))
        .order_by(m.DeckCard.id)
    ):
        catalog = row.card.catalog_card
        result[row.deck_id].append(
            s.CombatSnapshotCard(
                card_id=row.card_id,
                variant_type=row.variant_type,
                quantity_in_deck=row.quantity_in_deck,
                name=catalog.name,
                set_name=catalog.set_name,
                image_path=catalog.image_path,
                supertype=catalog.supertype,
            ).model_dump()
        )
    return result


def _combat_deck(db: Session, deck_id: int) -> m.Deck:
    """A normal deck of any cards user."""
    deck = db.get(m.Deck, deck_id)
    if deck is None or not deck.owner.can_use("cards"):
        raise not_found("Deck")
    if deck.deck_type != "normal":
        raise invalid("A phantom deck can't be used in a combat")
    return deck


def _player(db: Session, user_id: int) -> User:
    player = db.get(User, user_id)
    if player is None or not player.can_use("cards"):
        raise not_found("Player")
    return player


def combats_out(
    db: Session, combats: list[m.Combat], language: str | None
) -> list[s.CombatOut]:
    """Snapshot cards are stored in English; French viewers get the catalog
    card's French values, matched by `image_path` (one query)."""
    current: dict[str, m.CardCatalog] = {}
    if language == "fr":
        paths = {
            card["image_path"]
            for combat in combats
            for card in combat.deck_a_snapshot + combat.deck_b_snapshot
        }
        if paths:
            current = {
                card.image_path: card
                for card in db.scalars(
                    select(m.CardCatalog).where(m.CardCatalog.image_path.in_(paths))
                )
            }

    def side(snapshot: list[dict]) -> list[s.CombatSnapshotCard]:
        cards = []
        for stored in snapshot:
            card = s.CombatSnapshotCard.model_validate(stored)
            catalog = current.get(card.image_path)
            if catalog is not None:
                card.name = display.card_name(catalog, language)
                card.set_name = display.set_name(
                    catalog.set_name, catalog.set_name_fr, language
                )
                card.image_path = display.image_path(catalog, language)
            cards.append(card)
        return cards

    return [
        s.CombatOut(
            id=combat.id,
            deck_a_id=combat.deck_a_id,
            deck_a_name=(
                combat.deck_a.name if combat.deck_a else combat.deck_a_name_snapshot
            ),
            player_a_id=combat.player_a_id,
            player_a_pseudo=combat.player_a.pseudo,
            deck_b_id=combat.deck_b_id,
            deck_b_name=(
                combat.deck_b.name if combat.deck_b else combat.deck_b_name_snapshot
            ),
            player_b_id=combat.player_b_id,
            player_b_pseudo=combat.player_b.pseudo,
            winner=combat.winner,
            loser_score=combat.loser_score,
            played_at=combat.played_at,
            created_at=combat.created_at,
            deck_a_snapshot=side(combat.deck_a_snapshot),
            deck_b_snapshot=side(combat.deck_b_snapshot),
        )
        for combat in combats
    ]


def _reloaded(db: Session, ids: list[int]) -> list[m.Combat]:
    """These combats with their decks and players, in id order."""
    return db.scalars(
        _with_sides(select(m.Combat)).where(m.Combat.id.in_(ids)).order_by(m.Combat.id)
    ).all()


@router.get("", response_model=list[s.CombatOut])
def list_combats(user: User = Depends(cards_user), db: Session = Depends(get_db)):
    """Every combat, by played date, newest first."""
    combats = db.scalars(_newest_first(_with_sides(select(m.Combat)))).all()
    return combats_out(db, combats, user.language)


@router.post("", response_model=s.CombatOut, status_code=status.HTTP_201_CREATED)
def create_combat(
    body: s.CombatCreate,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Any cards users' normal decks (the same one twice is fine), any cards
    users as players (not necessarily the decks' owners)."""
    deck_a = _combat_deck(db, body.deck_a_id)
    deck_b = _combat_deck(db, body.deck_b_id)
    _player(db, body.player_a_id)
    _player(db, body.player_b_id)
    frozen = snapshots(db, {deck_a.id, deck_b.id})
    combat = m.Combat(
        deck_a_id=deck_a.id,
        player_a_id=body.player_a_id,
        deck_b_id=deck_b.id,
        player_b_id=body.player_b_id,
        winner=body.winner,
        loser_score=body.loser_score,
        played_at=body.played_at or s.midnight_utc(datetime.now(UTC)),
        deck_a_snapshot=frozen[deck_a.id],
        deck_b_snapshot=frozen[deck_b.id],
        deck_a_name_snapshot=deck_a.name,
        deck_b_name_snapshot=deck_b.name,
    )
    db.add(combat)
    db.commit()
    return combats_out(db, _reloaded(db, [combat.id]), user.language)[0]


@router.delete("", response_model=s.CombatWipeResult)
def delete_all_combats(user: User = Depends(cards_user), db: Session = Depends(get_db)):
    """The combats the user played (either side); every combat for an
    admin. Decks and the collection are untouched."""
    query = delete(m.Combat)
    if not user.is_admin:
        query = query.where(
            or_(m.Combat.player_a_id == user.id, m.Combat.player_b_id == user.id)
        )
    deleted = db.execute(query).rowcount
    db.commit()
    logger.warning("cards combats wiped (user %s): %d combats", user.id, deleted)
    return s.CombatWipeResult(deleted_combats=deleted)


# ── export / import ──────────────────────────────────────────────────────────


@router.get("/export", response_model=s.CombatsFile)
def export_combats(_: User = Depends(cards_user), db: Session = Depends(get_db)):
    """`combats.json`: every combat, newest first, decks by name and owner
    email, players by email, snapshots as stored (English)."""
    combats = db.scalars(_newest_first(_with_sides(select(m.Combat)))).all()
    entries = []
    for combat in combats:
        entry = {}
        for side in SIDES:
            deck: m.Deck | None = getattr(combat, f"deck_{side}")
            player: User = getattr(combat, f"player_{side}")
            entry |= {
                f"deck_{side}_name": (
                    deck.name if deck else getattr(combat, f"deck_{side}_name_snapshot")
                ),
                f"deck_{side}_owner_email": deck.owner.email if deck else None,
                f"player_{side}_email": player.email,
                f"player_{side}_pseudo": player.pseudo,
                f"deck_{side}_snapshot": getattr(combat, f"deck_{side}_snapshot"),
            }
        entries.append(
            s.CombatFileEntry(
                **entry,
                winner=combat.winner,
                loser_score=combat.loser_score,
                played_at=combat.played_at,
            )
        )
    return s.CombatsFile(combats=entries)


def _import_combats(db: Session, entries: list[s.CombatFileEntry]) -> list[m.Combat]:
    if not entries:
        raise invalid("The file has no combats")
    emails = {
        getattr(entry, f"player_{side}_email").lower()
        for entry in entries
        for side in SIDES
    }
    players = {
        player.email.lower(): player
        for player in db.scalars(
            select(User).where(func.lower(User.email).in_(emails), is_cards_user())
        )
    }
    names = {getattr(entry, f"deck_{side}_name") for entry in entries for side in SIDES}
    by_owner: dict[tuple[str, str], m.Deck] = {}
    by_name: dict[str, m.Deck] = {}
    for deck, email in db.execute(
        select(m.Deck, User.email)
        .join(User, User.id == m.Deck.user_id)
        .where(m.Deck.name.in_(names), m.Deck.deck_type == "normal", is_cards_user())
        .order_by(m.Deck.id)
    ).all():
        by_owner[(deck.name, email.lower())] = deck
        # Old files without owner emails: the oldest deck of that name.
        by_name.setdefault(deck.name, deck)

    # Per entry and side: (deck or None, player, snapshot from the file).
    resolved = []
    for number, entry in enumerate(entries, start=1):
        sides = {}
        for side in SIDES:
            name = getattr(entry, f"deck_{side}_name")
            owner = getattr(entry, f"deck_{side}_owner_email")
            deck = by_owner.get((name, owner.lower())) if owner else by_name.get(name)
            snapshot = getattr(entry, f"deck_{side}_snapshot")
            if deck is None and snapshot is None:
                raise invalid(
                    f'Combat {number}: unknown deck "{name}" and no snapshot of it'
                )
            email = getattr(entry, f"player_{side}_email")
            player = players.get(email.lower())
            if player is None:
                raise invalid(f'Combat {number}: unknown player "{email}"')
            sides[side] = (deck, player, snapshot)
        resolved.append((entry, sides))

    frozen = snapshots(
        db,
        {
            deck.id
            for _, sides in resolved
            for deck, _, snapshot in sides.values()
            if snapshot is None
        },
    )
    combats = []
    for entry, sides in resolved:
        fields = {}
        for side, (deck, player, snapshot) in sides.items():
            fields |= {
                f"deck_{side}_id": deck.id if deck else None,
                f"player_{side}_id": player.id,
                f"deck_{side}_snapshot": (
                    frozen[deck.id]
                    if snapshot is None
                    else [card.model_dump() for card in snapshot]
                ),
                f"deck_{side}_name_snapshot": (
                    deck.name if deck else getattr(entry, f"deck_{side}_name")
                ),
            }
        combats.append(
            m.Combat(
                **fields,
                winner=entry.winner,
                loser_score=entry.loser_score,
                played_at=entry.played_at,
            )
        )
    return combats


@router.post(
    "/import-all",
    response_model=list[s.CombatOut],
    status_code=status.HTTP_201_CREATED,
)
def import_combats(
    body: s.CombatsFile, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """`combats.json`, all or nothing: one new combat per entry, in file
    order. Decks and players must exist (and use cards); a side whose deck
    is gone still imports from its snapshot, with no deck."""
    try:
        combats = _import_combats(db, body.combats)
    except HTTPException as error:
        logger.warning("cards combats import (user %s): %s", user.id, error.detail)
        raise
    db.add_all(combats)
    db.commit()
    return combats_out(db, _reloaded(db, [c.id for c in combats]), user.language)


# ── one combat ───────────────────────────────────────────────────────────────


def _combat(db: Session, combat_id: int) -> m.Combat:
    combat = db.get(m.Combat, combat_id)
    if combat is None:
        raise not_found("Combat")
    return combat


@router.put("/{combat_id}", response_model=s.CombatOut)
def update_combat(
    combat_id: int,
    body: s.CombatUpdate,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Every field. A side whose deck changes is snapshotted again from the
    new deck; an unchanged one keeps its snapshot."""
    combat = _combat(db, combat_id)
    changed: dict[str, m.Deck] = {}
    for side in SIDES:
        deck_id = getattr(body, f"deck_{side}_id")
        if deck_id is None:
            if getattr(combat, f"deck_{side}_id") is not None:
                raise invalid("A deck is required")
        elif deck_id != getattr(combat, f"deck_{side}_id"):
            changed[side] = _combat_deck(db, deck_id)
    _player(db, body.player_a_id)
    _player(db, body.player_b_id)
    frozen = snapshots(db, {deck.id for deck in changed.values()})
    for side, deck in changed.items():
        setattr(combat, f"deck_{side}_id", deck.id)
        setattr(combat, f"deck_{side}_snapshot", frozen[deck.id])
        setattr(combat, f"deck_{side}_name_snapshot", deck.name)
    combat.player_a_id = body.player_a_id
    combat.player_b_id = body.player_b_id
    combat.winner = body.winner
    combat.loser_score = body.loser_score
    combat.played_at = body.played_at
    db.commit()
    return combats_out(db, _reloaded(db, [combat.id]), user.language)[0]


@router.delete("/{combat_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_combat(
    combat_id: int, _: User = Depends(cards_user), db: Session = Depends(get_db)
):
    db.delete(_combat(db, combat_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
