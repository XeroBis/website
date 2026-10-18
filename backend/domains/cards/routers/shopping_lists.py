"""`/api/cards/shopping-lists`: checklists for a buying round, filled from
pasted decklists. `quantity_owned` is a manual tally, deliberately not
linked to the collection."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import case, exists, func, select
from sqlalchemy.orm import Session, selectinload

from core.database import get_db
from core.models import User
from domains.cards import decklists, display
from domains.cards import models as m
from domains.cards import schemas as s
from domains.cards.access import cards_user, not_found

router = APIRouter(prefix="/shopping-lists", tags=["cards"])


def invalid(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def _shopping_list(db: Session, list_id: int, user_id: int) -> m.ShoppingList:
    """One of the user's lists with its cards, else 404."""
    shopping_list = db.scalar(
        select(m.ShoppingList)
        .where(m.ShoppingList.id == list_id, m.ShoppingList.user_id == user_id)
        .options(
            selectinload(m.ShoppingList.cards).selectinload(
                m.ShoppingListCard.catalog_card
            )
        )
    )
    if shopping_list is None:
        raise not_found("Shopping list")
    return shopping_list


def _list_card(shopping_list: m.ShoppingList, row_id: int) -> m.ShoppingListCard:
    row = next((row for row in shopping_list.cards if row.id == row_id), None)
    if row is None:
        raise not_found("Card")
    return row


def _check_name(db: Session, user_id: int, name: str, list_id: int | None = None):
    """No other list of the user has this name, else 409."""
    taken = exists().where(
        m.ShoppingList.user_id == user_id, m.ShoppingList.name == name
    )
    if list_id is not None:
        taken = taken.where(m.ShoppingList.id != list_id)
    if db.scalar(select(taken)):
        raise HTTPException(
            status.HTTP_409_CONFLICT, f'A shopping list named "{name}" already exists'
        )


def _touch(shopping_list: m.ShoppingList) -> None:
    """`updated_at` moves on every change, also of its cards."""
    shopping_list.updated_at = func.now()


def card_out(row: m.ShoppingListCard, language: str | None) -> s.ShoppingListCardOut:
    catalog = row.catalog_card
    return s.ShoppingListCardOut(
        id=row.id,
        catalog_id=row.catalog_id,
        name=display.card_name(catalog, language),
        name_en=catalog.name,
        name_fr=display.card_name(catalog, "fr"),
        set_name=display.set_name(catalog.set_name, catalog.set_name_fr, language),
        set_code=catalog.set_code,
        card_number=catalog.card_number,
        image_path=display.image_path(catalog, language),
        supertype=catalog.supertype,
        quantity_needed=row.quantity_needed,
        quantity_owned=row.quantity_owned,
    )


def detail_out(db: Session, list_id: int, user: User) -> s.ShoppingListDetailOut:
    """Reloaded, so new and removed cards show."""
    shopping_list = _shopping_list(db, list_id, user.id)
    cards = shopping_list.cards
    return s.ShoppingListDetailOut(
        id=shopping_list.id,
        name=shopping_list.name,
        created_at=shopping_list.created_at,
        updated_at=shopping_list.updated_at,
        total_cards=len(cards),
        total_quantity_needed=sum(row.quantity_needed for row in cards),
        fully_got_cards=sum(row.quantity_owned == row.quantity_needed for row in cards),
        cards=[card_out(row, user.language) for row in cards],
    )


def _merge(db: Session, shopping_list: m.ShoppingList, text: str) -> tuple[int, int]:
    """Add a pasted decklist's matched cards: a card already listed needs
    that many more (its tally untouched), a new one starts at 0 owned.
    Unmatched lines are dropped; nothing matched is a 422. Returns (distinct
    cards matched, lines skipped)."""
    lines = decklists.parse(db, text)[1]
    matched = decklists.tally(lines)
    if not matched:
        raise invalid("No card of the pasted list matched the catalog")
    rows = {row.catalog_id: row for row in shopping_list.cards}
    for catalog_id, (_, quantity) in matched.items():
        if catalog_id in rows:
            rows[catalog_id].quantity_needed += quantity
        else:
            db.add(
                m.ShoppingListCard(
                    shopping_list_id=shopping_list.id,
                    catalog_id=catalog_id,
                    quantity_needed=quantity,
                )
            )
    _touch(shopping_list)
    return len(matched), sum(line.card is None for line in lines)


@router.get("", response_model=list[s.ShoppingListOut])
def list_shopping_lists(
    user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """The user's lists, newest first, with their totals (one query)."""
    row = m.ShoppingListCard
    rows = db.execute(
        select(
            m.ShoppingList,
            func.count(row.id),
            func.coalesce(func.sum(row.quantity_needed), 0),
            func.count(case((row.quantity_owned == row.quantity_needed, 1))),
        )
        .outerjoin(row, row.shopping_list_id == m.ShoppingList.id)
        .where(m.ShoppingList.user_id == user.id)
        .group_by(m.ShoppingList.id)
        .order_by(m.ShoppingList.created_at.desc(), m.ShoppingList.id.desc())
    ).all()
    return [
        s.ShoppingListOut(
            id=shopping_list.id,
            name=shopping_list.name,
            created_at=shopping_list.created_at,
            updated_at=shopping_list.updated_at,
            total_cards=cards,
            total_quantity_needed=needed,
            fully_got_cards=fully_got,
        )
        for shopping_list, cards, needed, fully_got in rows
    ]


@router.post(
    "",
    response_model=s.ShoppingListPasteResult,
    status_code=status.HTTP_201_CREATED,
)
def create_shopping_list(
    body: s.ShoppingListCreate,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """A new list, empty or filled from a pasted decklist (TCGplayer/PTCGL
    or Cardmarket, matched lines only)."""
    _check_name(db, user.id, body.name)
    shopping_list = m.ShoppingList(user_id=user.id, name=body.name)
    db.add(shopping_list)
    db.flush()
    added = skipped = 0
    if body.decklist_text and body.decklist_text.strip():
        added, skipped = _merge(db, shopping_list, body.decklist_text)
    db.commit()
    return s.ShoppingListPasteResult(
        shopping_list=detail_out(db, shopping_list.id, user),
        lines_added=added,
        lines_skipped=skipped,
    )


@router.get("/{list_id}", response_model=s.ShoppingListDetailOut)
def get_shopping_list(
    list_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    return detail_out(db, list_id, user)


@router.put("/{list_id}", response_model=s.ShoppingListDetailOut)
def rename_shopping_list(
    list_id: int,
    body: s.ShoppingListRename,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    shopping_list = _shopping_list(db, list_id, user.id)
    if body.name != shopping_list.name:
        _check_name(db, user.id, body.name, list_id)
        shopping_list.name = body.name
        db.commit()
    return detail_out(db, list_id, user)


@router.delete("/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shopping_list(
    list_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """Its cards follow."""
    db.delete(_shopping_list(db, list_id, user.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{list_id}/paste", response_model=s.ShoppingListPasteResult)
def paste_into_shopping_list(
    list_id: int,
    body: s.DecklistText,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Merge a pasted decklist into the list: quantities needed only go
    up."""
    added, skipped = _merge(
        db, _shopping_list(db, list_id, user.id), body.decklist_text
    )
    db.commit()
    return s.ShoppingListPasteResult(
        shopping_list=detail_out(db, list_id, user),
        lines_added=added,
        lines_skipped=skipped,
    )


@router.put("/{list_id}/cards/{row_id}", response_model=s.ShoppingListCardOut)
def set_quantity_owned(
    list_id: int,
    row_id: int,
    body: s.ShoppingListCardUpdate,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """The tally of copies secured so far, 0 to the quantity needed."""
    shopping_list = _shopping_list(db, list_id, user.id)
    row = _list_card(shopping_list, row_id)
    if body.quantity_owned > row.quantity_needed:
        raise invalid(f"At most {row.quantity_needed} needed")
    row.quantity_owned = body.quantity_owned
    _touch(shopping_list)
    db.commit()
    return card_out(row, user.language)


@router.delete("/{list_id}/cards/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_shopping_list_card(
    list_id: int,
    row_id: int,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    shopping_list = _shopping_list(db, list_id, user.id)
    db.delete(_list_card(shopping_list, row_id))
    _touch(shopping_list)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
