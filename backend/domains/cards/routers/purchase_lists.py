"""`/api/cards/purchase-lists`: bought orders not yet arrived ("Liste
d'achat"), created empty or imported from saved Cardmarket order pages. Their cards count as
owned in the missing views until the list is received, which adds them to
the collection (see data-model.md `cards` "Rules")."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session, selectinload

from core.database import get_db
from core.models import User
from domains.cards import cardmarket_orders, display
from domains.cards import models as m
from domains.cards import schemas as s
from domains.cards.access import cards_user, not_found
from domains.cards.deck_rules import owned_quantity
from domains.cards.routers.collection import cards_for, set_quantity

router = APIRouter(prefix="/purchase-lists", tags=["cards"])


def invalid(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def incoming_copies(user_id: int, variant_type: str | None = None):
    """Subquery `(catalog_id, copies)`: the user's copies on lists not
    received, over every print or only `variant_type`."""
    row = m.PurchaseListCard
    query = (
        select(row.catalog_id, func.sum(row.quantity).label("copies"))
        .join(m.PurchaseList, m.PurchaseList.id == row.purchase_list_id)
        .where(m.PurchaseList.user_id == user_id, m.PurchaseList.received_at.is_(None))
    )
    if variant_type is not None:
        query = query.where(row.variant_type == variant_type)
    return query.group_by(row.catalog_id).subquery()


# ── loading and output ───────────────────────────────────────────────────────


def _purchase_list(db: Session, list_id: int, user_id: int) -> m.PurchaseList:
    """One of the user's lists with its cards, else 404."""
    purchase_list = db.scalar(
        select(m.PurchaseList)
        .where(m.PurchaseList.id == list_id, m.PurchaseList.user_id == user_id)
        .options(
            selectinload(m.PurchaseList.cards)
            .selectinload(m.PurchaseListCard.catalog_card)
            .selectinload(m.CardCatalog.variants),
        )
    )
    if purchase_list is None:
        raise not_found("Purchase list")
    return purchase_list


def _incoming_list(db: Session, list_id: int, user_id: int) -> m.PurchaseList:
    """A list that can still be edited, else 404 / 409."""
    purchase_list = _purchase_list(db, list_id, user_id)
    if purchase_list.received_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This purchase list was already received"
        )
    return purchase_list


def _list_card(purchase_list: m.PurchaseList, row_id: int) -> m.PurchaseListCard:
    row = next((row for row in purchase_list.cards if row.id == row_id), None)
    if row is None:
        raise not_found("Card")
    return row


def _check_name(db: Session, user_id: int, name: str, list_id: int | None = None):
    """No other list of the user has this name, else 409."""
    taken = exists().where(
        m.PurchaseList.user_id == user_id, m.PurchaseList.name == name
    )
    if list_id is not None:
        taken = taken.where(m.PurchaseList.id != list_id)
    if db.scalar(select(taken)):
        raise HTTPException(
            status.HTTP_409_CONFLICT, f'A purchase list named "{name}" already exists'
        )


def _check_print(catalog_card: m.CardCatalog, variant_type: str) -> None:
    if variant_type not in {v.variant_type for v in catalog_card.variants}:
        raise invalid(f'"{variant_type}" is not a print of this card')


def _touch(purchase_list: m.PurchaseList) -> None:
    """`updated_at` moves on every change, also of its cards."""
    purchase_list.updated_at = func.now()


def _card_out(row: m.PurchaseListCard, language: str | None) -> s.PurchaseListCardOut:
    catalog = row.catalog_card
    return s.PurchaseListCardOut(
        id=row.id,
        catalog_id=row.catalog_id,
        variant_type=row.variant_type,
        quantity=row.quantity,
        name=display.card_name(catalog, language),
        set_name=display.set_name(catalog.set_name, catalog.set_name_fr, language),
        set_code=catalog.set_code,
        card_number=catalog.card_number,
        image_path=display.image_path(catalog, language),
        supertype=catalog.supertype,
        rarity=catalog.rarity,
        variants=[v.variant_type for v in catalog.variants],
    )


def _summary(purchase_list: m.PurchaseList) -> dict:
    return {
        "id": purchase_list.id,
        "name": purchase_list.name,
        "created_at": purchase_list.created_at,
        "updated_at": purchase_list.updated_at,
        "received_at": purchase_list.received_at,
        "price": purchase_list.price,
        "total_cards": len(purchase_list.cards),
        "total_quantity": sum(row.quantity for row in purchase_list.cards),
    }


def detail_out(db: Session, list_id: int, user: User) -> s.PurchaseListDetailOut:
    """Reloaded, so new and removed cards show; cards by set then number."""
    purchase_list = _purchase_list(db, list_id, user.id)
    rows = sorted(
        purchase_list.cards,
        key=lambda row: (
            row.catalog_card.set_code,
            _number_sort(row.catalog_card.card_number),
            row.id,
        ),
    )
    return s.PurchaseListDetailOut(
        **_summary(purchase_list),
        cards=[_card_out(row, user.language) for row in rows],
    )


def _number_sort(card_number: str) -> tuple[int, int, str]:
    """Numeric numbers first, in order, then the others."""
    number = card_number.strip()
    return (0, int(number), "") if number.isdigit() else (1, 0, number)


def _line(
    purchase_list: m.PurchaseList, catalog_id: int, variant_type: str
) -> m.PurchaseListCard | None:
    return next(
        (
            row
            for row in purchase_list.cards
            if row.catalog_id == catalog_id and row.variant_type == variant_type
        ),
        None,
    )


def _add(
    purchase_list: m.PurchaseList, catalog_id: int, variant_type: str, quantity: int
) -> None:
    """Copies of one print onto the list: onto its line, else a new one."""
    line = _line(purchase_list, catalog_id, variant_type)
    if line is not None:
        line.quantity += quantity
    else:
        purchase_list.cards.append(
            m.PurchaseListCard(
                catalog_id=catalog_id, variant_type=variant_type, quantity=quantity
            )
        )


# ── lists ────────────────────────────────────────────────────────────────────


@router.get("", response_model=list[s.PurchaseListOut])
def list_purchase_lists(
    user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """Incoming lists first, then received ones, each newest first."""
    lists = db.scalars(
        select(m.PurchaseList)
        .where(m.PurchaseList.user_id == user.id)
        .options(
            selectinload(m.PurchaseList.cards),
        )
        .order_by(
            m.PurchaseList.received_at.is_not(None),
            m.PurchaseList.created_at.desc(),
            m.PurchaseList.id.desc(),
        )
    ).all()
    return [s.PurchaseListOut(**_summary(purchase_list)) for purchase_list in lists]


@router.post(
    "", response_model=s.PurchaseListDetailOut, status_code=status.HTTP_201_CREATED
)
def create_purchase_list(
    body: s.PurchaseListCreate,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """An empty list, its cards added by hand."""
    _check_name(db, user.id, body.name)
    purchase_list = m.PurchaseList(user_id=user.id, name=body.name, price=body.price)
    db.add(purchase_list)
    db.commit()
    return detail_out(db, purchase_list.id, user)


@router.get("/incoming", response_model=list[s.IncomingPrint])
def list_incoming(
    set_code: str | None = None,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Copies per print over every incoming list (or one set's)."""
    row = m.PurchaseListCard
    query = (
        select(row.catalog_id, row.variant_type, func.sum(row.quantity))
        .join(m.PurchaseList, m.PurchaseList.id == row.purchase_list_id)
        .where(m.PurchaseList.user_id == user.id, m.PurchaseList.received_at.is_(None))
        .group_by(row.catalog_id, row.variant_type)
        .order_by(row.catalog_id, row.variant_type)
    )
    if set_code is not None:
        query = query.join(m.CardCatalog, m.CardCatalog.id == row.catalog_id).where(
            m.CardCatalog.set_code == set_code
        )
    return [
        s.IncomingPrint(catalog_id=catalog_id, variant_type=variant, quantity=copies)
        for catalog_id, variant, copies in db.execute(query)
    ]


def _read_order(db: Session, html: str) -> list[cardmarket_orders.Article]:
    articles = cardmarket_orders.read(db, html)
    if not articles:
        raise invalid("No Cardmarket article found in this file")
    return articles


@router.post("/cardmarket/preview", response_model=s.CardmarketPreview)
def preview_cardmarket_order(
    body: s.CardmarketOrder,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """The order as the import would read it; nothing is saved."""
    articles = _read_order(db, body.html)
    lines = []
    for article in articles:
        line = s.CardmarketLineOut(
            quantity=article.quantity,
            unit_price=article.unit_price,
            label=article.label,
            matched=article.matched,
            reason=article.reason,
        )
        if article.card is not None:
            card = article.card
            line.catalog_id = card.id
            line.variant_type = article.variant_type
            line.name = display.card_name(card, user.language)
            line.set_code = card.set_code
            line.card_number = card.card_number
            line.image_path = display.image_path(card, user.language)
        lines.append(line)
    matched = [a for a in articles if a.card is not None]
    return s.CardmarketPreview(
        total_quantity=sum(a.quantity for a in matched),
        total_price=cardmarket_orders.total_price(articles),
        set_codes=sorted({a.card.set_code for a in matched}),
        lines=lines,
    )


@router.post(
    "/cardmarket",
    response_model=s.CardmarketImportResult,
    status_code=status.HTTP_201_CREATED,
)
def import_cardmarket_order(
    body: s.CardmarketImport,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """A new list from the order's matched articles (repeats add up)."""
    articles = _read_order(db, body.html)
    matched = [a for a in articles if a.card is not None]
    if not matched:
        raise invalid("No article of the order matched the catalog")
    _check_name(db, user.id, body.name)
    purchase_list = m.PurchaseList(
        user_id=user.id, name=body.name, price=body.price, cards=[]
    )
    for article in matched:
        _add(purchase_list, article.card.id, article.variant_type, article.quantity)
    db.add(purchase_list)
    db.commit()
    return s.CardmarketImportResult(
        purchase_list=detail_out(db, purchase_list.id, user),
        unmatched=[
            s.UnmatchedArticle(
                quantity=a.quantity, label=a.label, reason=a.reason or ""
            )
            for a in articles
            if a.card is None
        ],
    )


@router.get("/{list_id}", response_model=s.PurchaseListDetailOut)
def get_purchase_list(
    list_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    return detail_out(db, list_id, user)


@router.put("/{list_id}", response_model=s.PurchaseListDetailOut)
def rename_purchase_list(
    list_id: int,
    body: s.PurchaseListRename,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    purchase_list = _purchase_list(db, list_id, user.id)
    if body.name != purchase_list.name:
        _check_name(db, user.id, body.name, list_id)
        purchase_list.name = body.name
        db.commit()
    return detail_out(db, list_id, user)


@router.delete("/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_purchase_list(
    list_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """Its cards follow."""
    db.delete(_purchase_list(db, list_id, user.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{list_id}/receive", response_model=s.PurchaseListDetailOut)
def receive_purchase_list(
    list_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """Every line onto the collection (history source `purchase`), and the
    list closed, all or nothing."""
    purchase_list = _incoming_list(db, list_id, user.id)
    rows = purchase_list.cards
    catalog = {row.catalog_id: row.catalog_card for row in rows}
    cards = cards_for(db, user.id, catalog)
    for row in rows:
        card = cards[row.catalog_id]
        set_quantity(
            db,
            card,
            row.variant_type,
            owned_quantity(card, row.variant_type) + row.quantity,
            "purchase",
        )
    purchase_list.received_at = func.now()
    db.commit()
    return detail_out(db, list_id, user)


# ── cards ────────────────────────────────────────────────────────────────────


@router.post(
    "/{list_id}/cards",
    response_model=s.PurchaseListDetailOut,
    status_code=status.HTTP_201_CREATED,
)
def add_purchase_list_card(
    list_id: int,
    body: s.PurchaseListCardAdd,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """A card by hand, onto its line of that print if there is one."""
    purchase_list = _incoming_list(db, list_id, user.id)
    catalog_card = db.get(m.CardCatalog, body.catalog_id)
    if catalog_card is None:
        raise not_found("Card")
    _check_print(catalog_card, body.variant_type)
    _add(purchase_list, catalog_card.id, body.variant_type, body.quantity)
    _touch(purchase_list)
    db.commit()
    return detail_out(db, list_id, user)


@router.put("/{list_id}/cards/{row_id}", response_model=s.PurchaseListDetailOut)
def update_purchase_list_card(
    list_id: int,
    row_id: int,
    body: s.PurchaseListCardUpdate,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """A line's quantity and print; moved to a print already on the list,
    its copies go onto that line."""
    purchase_list = _incoming_list(db, list_id, user.id)
    row = _list_card(purchase_list, row_id)
    _check_print(row.catalog_card, body.variant_type)
    other = _line(purchase_list, row.catalog_id, body.variant_type)
    if other is not None and other is not row:
        other.quantity += body.quantity
        purchase_list.cards.remove(row)
    else:
        row.variant_type = body.variant_type
        row.quantity = body.quantity
    _touch(purchase_list)
    db.commit()
    return detail_out(db, list_id, user)


@router.delete("/{list_id}/cards/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_purchase_list_card(
    list_id: int,
    row_id: int,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    purchase_list = _incoming_list(db, list_id, user.id)
    purchase_list.cards.remove(_list_card(purchase_list, row_id))
    _touch(purchase_list)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
