"""Workout users, for the "Viewing" select (read-only sharing)."""

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from core.database import get_db
from core.models import User, UserApp
from domains.workout import schemas as s
from domains.workout.access import workout_user

router = APIRouter(tags=["workout"])


@router.get("/users", response_model=list[s.WorkoutUser])
def list_users(user: User = Depends(workout_user), db: Session = Depends(get_db)):
    """Everyone who can use workout (grant or admin), current user first."""
    granted = select(UserApp.user_id).where(UserApp.app == "workout")
    users = db.scalars(
        select(User)
        .where(or_(User.is_admin, User.id.in_(granted)))
        .order_by(User.id != user.id, func.lower(User.pseudo), User.id)
    ).all()
    return users
