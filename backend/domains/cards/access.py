"""Who may read and write what in `/api/cards` (see data-model.md `cards`)."""

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.orm import Session

from core.deps import require_app
from core.models import User, UserApp

# A session with the `cards` app (or admin), plus CSRF on unsafe methods.
# Catalog administration uses core.deps.require_admin instead.
cards_user = require_app("cards")


def not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")


def owned(db: Session, model, row_id: int, user_id: int, what: str):
    """A row belonging to `user_id`, else 404 (whoever else it belongs to)."""
    row = db.get(model, row_id)
    if row is None or row.user_id != user_id:
        raise not_found(what)
    return row


def is_cards_user() -> ColumnElement[bool]:
    """WHERE condition on `User`: can use the cards app (grant or admin)."""
    granted = select(UserApp.user_id).where(UserApp.app == "cards")
    return or_(User.is_admin, User.id.in_(granted))
