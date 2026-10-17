"""Logged workouts: list (own or another workout user's, read-only), manual
create/edit, delete."""

from datetime import date

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.database import get_db
from core.models import User
from domains.workout import entries
from domains.workout import models as m
from domains.workout import schemas as s
from domains.workout.access import not_found, owned, viewed_user_id, workout_user

router = APIRouter(tags=["workout"])


def completed(user_id: int):
    """The user's completed workouts, newest first."""
    return (
        select(m.Workout)
        .where(m.Workout.user_id == user_id, m.Workout.status == "completed")
        .order_by(m.Workout.date.desc(), m.Workout.id.desc())
    )


def _own_completed(db: Session, user: User, workout_id: int) -> m.Workout:
    workout = owned(db, m.Workout, workout_id, user.id, "Workout")
    if workout.status != "completed":
        raise not_found("Workout")
    return workout


@router.get("/workouts", response_model=list[s.WorkoutOut])
def list_workouts(
    user_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    exercise_id: int | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    query = completed(viewed_user_id(db, user, user_id))
    if date_from is not None:
        query = query.where(m.Workout.date >= date_from)
    if date_to is not None:
        query = query.where(m.Workout.date <= date_to)
    if exercise_id is not None:
        query = query.where(
            m.Workout.exercises.any(m.WorkoutExercise.exercise_id == exercise_id)
        )
    workouts = db.scalars(query.offset(offset).limit(limit)).all()
    return [entries.workout_out(w) for w in workouts]


@router.get("/workouts/{workout_id}", response_model=s.WorkoutOut)
def get_workout(
    workout_id: int,
    user_id: int | None = None,
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    owner = viewed_user_id(db, user, user_id)
    workout = db.get(m.Workout, workout_id)
    if workout is None or workout.user_id != owner or workout.status != "completed":
        raise not_found("Workout")
    return entries.workout_out(workout)


def _save(db: Session, workout: m.Workout, body: s.WorkoutIn) -> s.WorkoutOut:
    entries.check_exercises_exist(db, entries.exercise_ids(body.exercises))
    workout.date = body.date
    workout.duration_minutes = body.duration_minutes
    entries.build(workout, entries.WORKOUT, body.exercises)
    db.add(workout)
    db.commit()
    db.refresh(workout)
    return entries.workout_out(workout)


@router.post(
    "/workouts", response_model=s.WorkoutOut, status_code=status.HTTP_201_CREATED
)
def create_workout(
    body: s.WorkoutIn, user: User = Depends(workout_user), db: Session = Depends(get_db)
):
    return _save(db, m.Workout(user_id=user.id, status="completed"), body)


@router.put("/workouts/{workout_id}", response_model=s.WorkoutOut)
def update_workout(
    workout_id: int,
    body: s.WorkoutIn,
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    return _save(db, _own_completed(db, user, workout_id), body)


@router.delete("/workouts/{workout_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workout(
    workout_id: int, user: User = Depends(workout_user), db: Session = Depends(get_db)
):
    db.delete(_own_completed(db, user, workout_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
