"""`GET /stats`: the dashboard's aggregates (own or another workout user's)."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from core.database import get_db
from core.models import User
from domains.workout import schemas as s
from domains.workout import stats
from domains.workout.access import viewed_user_id, workout_user
from domains.workout.models import Workout
from domains.workout.routers.workouts import completed

router = APIRouter(tags=["workout"])


@router.get("/stats", response_model=s.Stats)
def get_stats(
    user_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "date_from is after date_to"
        )
    query = completed(viewed_user_id(db, user, user_id))
    if date_from is not None:
        query = query.where(Workout.date >= date_from)
    if date_to is not None:
        query = query.where(Workout.date <= date_to)
    return stats.compute(db.scalars(query).all(), date_from, date_to)
