"""Cards users, for the combat player pickers."""

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.database import get_db
from core.models import User
from domains.cards import schemas as s
from domains.cards.access import cards_user, is_cards_user

router = APIRouter(tags=["cards"])


@router.get("/users", response_model=list[s.CardsUser])
def list_users(user: User = Depends(cards_user), db: Session = Depends(get_db)):
    """Everyone who can use cards (grant or admin), current user first."""
    return db.scalars(
        select(User)
        .where(is_cards_user())
        .order_by(User.id != user.id, func.lower(User.pseudo), User.id)
    ).all()
