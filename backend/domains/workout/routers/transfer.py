"""Your own import/export: workouts, templates, saved circuits (`/data` page)."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.database import get_db
from core.models import User
from domains.workout import models as m
from domains.workout import schemas as s
from domains.workout import transfer
from domains.workout.access import workout_user
from domains.workout.routers.circuits import user_circuits
from domains.workout.routers.templates import user_templates

router = APIRouter(tags=["workout"])


def user_workouts_file(db: Session, user_id: int) -> list[dict]:
    """The user's completed workouts, oldest first, in the file format."""
    workouts = db.scalars(
        select(m.Workout)
        .where(m.Workout.user_id == user_id, m.Workout.status == "completed")
        .order_by(m.Workout.date, m.Workout.id)
    )
    return [transfer.workout_file(w) for w in workouts]


def user_templates_file(db: Session, user_id: int) -> list[dict]:
    return [transfer.template_file(t) for t in db.scalars(user_templates(user_id))]


@router.get("/workouts/export")
def export_workouts(user: User = Depends(workout_user), db: Session = Depends(get_db)):
    return user_workouts_file(db, user.id)


@router.post("/workouts/import", response_model=s.ImportResult)
def import_workouts(
    files: list[s.WorkoutFile],
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    result = s.ImportResult()
    transfer.import_workouts(db, user.id, files, result)
    db.commit()
    return result


@router.get("/templates/export")
def export_templates(user: User = Depends(workout_user), db: Session = Depends(get_db)):
    return user_templates_file(db, user.id)


@router.post("/templates/import", response_model=s.ImportResult)
def import_templates(
    files: list[s.TemplateFile],
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    result = s.ImportResult()
    transfer.import_templates(db, user.id, files, result)
    db.commit()
    return result


@router.get("/circuits/export")
def export_circuits(user: User = Depends(workout_user), db: Session = Depends(get_db)):
    return [transfer.circuit_file(c) for c in db.scalars(user_circuits(user.id))]


@router.post("/circuits/import", response_model=s.ImportResult)
def import_circuits(
    files: list[s.SavedCircuitFile],
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    result = s.ImportResult()
    transfer.import_circuits(db, user.id, files, result)
    db.commit()
    return result
