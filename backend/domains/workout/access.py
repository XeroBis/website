"""Who may read and write what in `/api/workout` (see data-model.md "Rules")."""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from core.deps import require_app
from core.models import User

# A session with the `workout` app (or admin), plus CSRF on unsafe methods.
workout_user = require_app("workout")


def not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")


def viewed_user_id(db: Session, user: User, user_id: int | None) -> int:
    """The user whose data a read route shows: `user_id` if that's another
    workout user (read-only sharing), else the current user."""
    if user_id is None or user_id == user.id:
        return user.id
    other = db.get(User, user_id)
    if other is None or not other.can_use("workout"):
        raise not_found("User")
    return other.id


def owned(db: Session, model, row_id: int, user_id: int, what: str):
    """A row belonging to `user_id`, else 404 (whoever else it belongs to)."""
    row = db.get(model, row_id)
    if row is None or row.user_id != user_id:
        raise not_found(what)
    return row
