"""`/api/cards/purchases`: "What I Paid", a private spend log not linked to
the collection, with export / import / delete-all."""

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from core.database import get_db
from core.models import User
from domains.cards import models as m
from domains.cards import schemas as s
from domains.cards.access import cards_user, owned

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/purchases", tags=["cards"])


def _newest_first(user_id: int):
    return (
        select(m.Purchase)
        .where(m.Purchase.user_id == user_id)
        .order_by(m.Purchase.purchased_at.desc(), m.Purchase.id.desc())
    )


def _fields(body: s.PurchaseIn) -> dict:
    return body.model_dump() | {
        "purchased_at": body.purchased_at or s.midnight_utc(datetime.now(UTC))
    }


@router.get("", response_model=list[s.PurchaseOut])
def list_purchases(user: User = Depends(cards_user), db: Session = Depends(get_db)):
    """The user's purchases by date, newest first."""
    return db.scalars(_newest_first(user.id)).all()


@router.post("", response_model=s.PurchaseOut, status_code=status.HTTP_201_CREATED)
def create_purchase(
    body: s.PurchaseIn, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    purchase = m.Purchase(user_id=user.id, **_fields(body))
    db.add(purchase)
    db.commit()
    return purchase


@router.delete("", response_model=s.PurchaseWipeResult)
def delete_all_purchases(
    user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """Every purchase of the user; other users' are untouched."""
    deleted = db.execute(
        delete(m.Purchase).where(m.Purchase.user_id == user.id)
    ).rowcount
    db.commit()
    logger.warning("cards purchases wiped (user %s): %d purchases", user.id, deleted)
    return s.PurchaseWipeResult(deleted_purchases=deleted)


@router.get("/export", response_model=s.PurchasesFile)
def export_purchases(user: User = Depends(cards_user), db: Session = Depends(get_db)):
    """`purchases.json`: every purchase of the user, newest first."""
    return s.PurchasesFile(
        purchases=[
            s.PurchaseFileEntry.model_validate(purchase, from_attributes=True)
            for purchase in db.scalars(_newest_first(user.id))
        ]
    )


@router.post(
    "/import-all",
    response_model=list[s.PurchaseOut],
    status_code=status.HTTP_201_CREATED,
)
def import_purchases(
    body: s.PurchasesFile,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """`purchases.json`, all or nothing: one new purchase per entry, in file
    order (the body is validated as a whole before anything is written)."""
    if not body.purchases:
        logger.warning("cards purchases import (user %s): empty file", user.id)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "The file has no purchases"
        )
    purchases = [
        m.Purchase(user_id=user.id, **entry.model_dump()) for entry in body.purchases
    ]
    db.add_all(purchases)
    db.commit()
    return purchases


def _purchase(db: Session, purchase_id: int, user_id: int) -> m.Purchase:
    return owned(db, m.Purchase, purchase_id, user_id, "Purchase")


@router.put("/{purchase_id}", response_model=s.PurchaseOut)
def update_purchase(
    purchase_id: int,
    body: s.PurchaseUpdate,
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """Every field."""
    purchase = _purchase(db, purchase_id, user.id)
    for field, value in body.model_dump().items():
        setattr(purchase, field, value)
    db.commit()
    return purchase


@router.delete("/{purchase_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_purchase(
    purchase_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    db.delete(_purchase(db, purchase_id, user.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
