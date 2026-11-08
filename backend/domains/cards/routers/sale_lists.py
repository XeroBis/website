"""`/api/cards/sale-lists`: cards the user is selling ("Liste des ventes"),
created empty and filled from the collection. Their copies are reserved
until the list is sold, which takes them off the collection (see
data-model.md `cards` "Rules")."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session, selectinload

from core.database import get_db
from core.models import User
from domains.cards import deck_rules
from domains.cards import models as m
from domains.cards import schemas as s
from domains.cards.access import cards_user, not_found
from domains.cards.routers.collection import set_quantity
from domains.cards.routers.purchase_lists import (
    _card_out,
    _catalog_cards,
    _number_sort,
)

router = APIRouter(prefix="/sale-lists", tags=["cards"])


# ── loading and output ───────────────────────────────────────────────────────


def _sale_list(db: Session, list_id: int, user_id: int) -> m.SaleList:
    """One of the user's lists with its cards, else 404."""
    sale_list = db.scalar(
        select(m.SaleList)
        .where(m.SaleList.id == list_id, m.SaleList.user_id == user_id)
        .options(
            selectinload(m.SaleList.cards)
            .selectinload(m.SaleListCard.catalog_card)
            .selectinload(m.CardCatalog.variants),
        )
    )
    if sale_list is None:
        raise not_found("Sale list")
    return sale_list


def _open_list(db: Session, list_id: int, user_id: int) -> m.SaleList:
    """A list that can still be edited, else 404 / 409."""
    sale_list = _sale_list(db, list_id, user_id)
    if sale_list.sold_at is not None:
        raise deck_rules.refused("This sale list was already sold")
    return sale_list


def _list_card(sale_list: m.SaleList, row_id: int) -> m.SaleListCard:
    row = next((row for row in sale_list.cards if row.id == row_id), None)
    if row is None:
        raise not_found("Card")
    return row


def _check_name(db: Session, user_id: int, name: str, list_id: int | None = None):
    """No other list of the user has this name, else 409."""
    taken = exists().where(m.SaleList.user_id == user_id, m.SaleList.name == name)
    if list_id is not None:
        taken = taken.where(m.SaleList.id != list_id)
    if db.scalar(select(taken)):
        raise HTTPException(
            status.HTTP_409_CONFLICT, f'A sale list named "{name}" already exists'
        )


def _sellable(db: Session, user_id: int, catalog_id: int, variant_type: str) -> int:
    """Copies of a print not in a normal deck nor on an unsold sale list."""
    owned, outside_decks = deck_rules.availability(
        db, user_id, [(catalog_id, variant_type)]
    )[(catalog_id, variant_type)]
    on_sale = deck_rules.on_sale_by_print(db, user_id, [catalog_id]).get(
        (catalog_id, variant_type), 0
    )
    return max(outside_decks - on_sale, 0)


def _check_copies(
    db: Session,
    user_id: int,
    catalog_card: m.CardCatalog,
    variant_type: str,
    extra: int,
) -> None:
    """`extra` more copies of this print can go on sale, else 409."""
    if extra <= 0:
        return
    spare = _sellable(db, user_id, catalog_card.id, variant_type)
    if extra > spare:
        raise deck_rules.refused(
            f'Only {spare} copies of "{catalog_card.name}" ({variant_type})'
            " can be put on sale (owned, outside decks and other sale lists)"
        )


def _touch(sale_list: m.SaleList) -> None:
    """`updated_at` moves on every change, also of its cards."""
    sale_list.updated_at = func.now()


def _summary(sale_list: m.SaleList) -> dict:
    return {
        "id": sale_list.id,
        "name": sale_list.name,
        "created_at": sale_list.created_at,
        "updated_at": sale_list.updated_at,
        "sold_at": sale_list.sold_at,
        "total_cards": len(sale_list.cards),
        "total_quantity": sum(row.quantity for row in sale_list.cards),
    }


def detail_out(db: Session, list_id: int, user: User) -> s.SaleListDetailOut:
    """Reloaded, so new and removed cards show; cards by set then number."""
    sale_list = _sale_list(db, list_id, user.id)
    rows = sorted(
        sale_list.cards,
        key=lambda row: (
            row.catalog_card.set_code,
            _number_sort(row.catalog_card.card_number),
            row.id,
        ),
    )
    return s.SaleListDetailOut(
        **_summary(sale_list),
        cards=[_card_out(row, user.language) for row in rows],
    )


def _line(
    sale_list: m.SaleList, catalog_id: int, variant_type: str
) -> m.SaleListCard | None:
    return next(
        (
            row
            for row in sale_list.cards
            if row.catalog_id == catalog_id and row.variant_type == variant_type
        ),
        None,
    )


def _add(
    sale_list: m.SaleList, catalog_id: int, variant_type: str, quantity: int
) -> None:
    """Copies of one print onto the list: onto its line, else a new one."""
    line = _line(sale_list, catalog_id, variant_type)
    if line is not None:
        line.quantity += quantity
    else:
        sale_list.cards.append(
            m.SaleListCard(
                catalog_id=catalog_id, variant_type=variant_type, quantity=quantity
            )
        )


# ── lists ────────────────────────────────────────────────────────────────────


@router.get("", response_model=list[s.SaleListOut])
def list_sale_lists(user: User = Depends(cards_user), db: Session = Depends(get_db)):
    """Lists on sale first, then sold ones, each newest first."""
    lists = db.scalars(
        select(m.SaleList)
        .where(m.SaleList.user_id == user.id)
        .options(selectinload(m.SaleList.cards))
        .order_by(
            m.SaleList.sold_at.is_not(None),
            m.SaleList.created_at.desc(),
            m.SaleList.id.desc(),
        )
    ).all()
    return [s.SaleListOut(**_summary(sale_list)) for sale_list in lists]


@router.post(
    "", response_model=s.SaleListDetailOut, status_code=status.HTTP_201_CREATED
)
def create_sale_list(
    body: s.SaleListCreate,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """An empty list, its cards added from the collection."""
    _check_name(db, user.id, body.name)
    sale_list = m.SaleList(user_id=user.id, name=body.name)
    db.add(sale_list)
    db.commit()
    return detail_out(db, sale_list.id, user)


@router.get("/on-sale", response_model=list[s.OnSalePrint])
def list_on_sale(user: User = Depends(cards_user), db: Session = Depends(get_db)):
    """Copies per print over every unsold list."""
    row = m.SaleListCard
    query = (
        select(row.catalog_id, row.variant_type, func.sum(row.quantity))
        .join(m.SaleList, m.SaleList.id == row.sale_list_id)
        .where(m.SaleList.user_id == user.id, m.SaleList.sold_at.is_(None))
        .group_by(row.catalog_id, row.variant_type)
        .order_by(row.catalog_id, row.variant_type)
    )
    return [
        s.OnSalePrint(catalog_id=catalog_id, variant_type=variant, quantity=copies)
        for catalog_id, variant, copies in db.execute(query)
    ]


@router.get("/{list_id}", response_model=s.SaleListDetailOut)
def get_sale_list(
    list_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    return detail_out(db, list_id, user)


@router.put("/{list_id}", response_model=s.SaleListDetailOut)
def rename_sale_list(
    list_id: int,
    body: s.SaleListRename,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    sale_list = _sale_list(db, list_id, user.id)
    if body.name != sale_list.name:
        _check_name(db, user.id, body.name, list_id)
        sale_list.name = body.name
        db.commit()
    return detail_out(db, list_id, user)


@router.delete("/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sale_list(
    list_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """Its cards follow (the collection is untouched)."""
    db.delete(_sale_list(db, list_id, user.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{list_id}/sell", response_model=s.SaleListDetailOut)
def sell_sale_list(
    list_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """Every line off the collection (history source `sale`), and the list
    closed, all or nothing."""
    sale_list = _open_list(db, list_id, user.id)
    rows = sale_list.cards
    cards = deck_rules.owned_cards(db, user.id, {row.catalog_id for row in rows})
    allocated = deck_rules.allocated_by_print(db, [c.id for c in cards.values()])
    for row in rows:
        card = cards.get(row.catalog_id)
        owned = deck_rules.owned_quantity(card, row.variant_type)
        in_decks = allocated.get((card.id, row.variant_type), 0) if card else 0
        if row.quantity > owned - in_decks:
            raise deck_rules.refused(
                f"Only {max(owned - in_decks, 0)} copies of"
                f' "{row.catalog_card.name}" ({row.variant_type}) outside decks'
            )
        set_quantity(db, card, row.variant_type, owned - row.quantity, "sale")
    for card in cards.values():
        if not card.variant_quantities:
            db.delete(card)
    sale_list.sold_at = func.now()
    db.commit()
    return detail_out(db, list_id, user)


# ── cards ────────────────────────────────────────────────────────────────────


@router.post(
    "/{list_id}/cards",
    response_model=s.SaleListDetailOut,
    status_code=status.HTTP_201_CREATED,
)
def add_sale_list_card(
    list_id: int,
    body: s.SaleListCardAdd,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Owned copies, onto the line of that print if there is one."""
    sale_list = _open_list(db, list_id, user.id)
    catalog_card = db.get(m.CardCatalog, body.catalog_id)
    if catalog_card is None:
        raise not_found("Card")
    _check_copies(db, user.id, catalog_card, body.variant_type, body.quantity)
    _add(sale_list, catalog_card.id, body.variant_type, body.quantity)
    _touch(sale_list)
    db.commit()
    return detail_out(db, list_id, user)


@router.post(
    "/{list_id}/cards/bulk",
    response_model=s.SaleListDetailOut,
    status_code=status.HTTP_201_CREATED,
)
def add_sale_list_cards(
    list_id: int,
    body: s.SaleListCardsAdd,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Several cards from the collection, all or nothing; repeats add up
    and are checked together against the sellable copies."""
    sale_list = _open_list(db, list_id, user.id)
    wanted: dict[tuple[int, str], int] = {}
    for item in body.items:
        key = (item.catalog_id, item.variant_type)
        wanted[key] = wanted.get(key, 0) + item.quantity
    catalog = _catalog_cards(db, {catalog_id for catalog_id, _ in wanted})
    for (catalog_id, variant), copies in wanted.items():
        _check_copies(db, user.id, catalog[catalog_id], variant, copies)
    for (catalog_id, variant), copies in wanted.items():
        _add(sale_list, catalog_id, variant, copies)
    _touch(sale_list)
    db.commit()
    return detail_out(db, list_id, user)


@router.put("/{list_id}/cards/{row_id}", response_model=s.SaleListDetailOut)
def update_sale_list_card(
    list_id: int,
    row_id: int,
    body: s.SaleListCardUpdate,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """A line's quantity and print; moved to a print already on the list,
    its copies go onto that line."""
    sale_list = _open_list(db, list_id, user.id)
    row = _list_card(sale_list, row_id)
    same_print = body.variant_type == row.variant_type
    # Copies this change adds on sale for the target print.
    extra = body.quantity - row.quantity if same_print else body.quantity
    _check_copies(db, user.id, row.catalog_card, body.variant_type, extra)
    other = _line(sale_list, row.catalog_id, body.variant_type)
    if other is not None and other is not row:
        other.quantity += body.quantity
        sale_list.cards.remove(row)
    else:
        row.variant_type = body.variant_type
        row.quantity = body.quantity
    _touch(sale_list)
    db.commit()
    return detail_out(db, list_id, user)


@router.delete("/{list_id}/cards/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_sale_list_card(
    list_id: int,
    row_id: int,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    sale_list = _open_list(db, list_id, user.id)
    sale_list.cards.remove(_list_card(sale_list, row_id))
    _touch(sale_list)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
