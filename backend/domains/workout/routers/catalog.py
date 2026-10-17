"""The shared catalog: muscles, exercises, equipments. Any workout user reads
and adds; only admins edit and delete."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.database import get_db
from core.deps import require_admin
from core.models import User
from domains.workout import models as m
from domains.workout import schemas as s
from domains.workout.access import not_found, workout_user
from domains.workout.catalog import apply_exercise, exercise_in_use
from domains.workout.muscles import MUSCLES

router = APIRouter(tags=["workout"])


@router.get("/muscles", response_model=list[str])
def list_muscles(_: User = Depends(workout_user)):
    return list(MUSCLES)


def _commit_or_conflict(db: Session, what: str) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"An {what} with this name already exists"
        ) from None


# ── exercises ────────────────────────────────────────────────────────────────


def _exercise_or_404(db: Session, exercise_id: int) -> m.Exercise:
    exercise = db.get(m.Exercise, exercise_id)
    if exercise is None:
        raise not_found("Exercise")
    return exercise


@router.get("/exercises", response_model=list[s.ExerciseOut])
def list_exercises(_: User = Depends(workout_user), db: Session = Depends(get_db)):
    return db.scalars(select(m.Exercise).order_by(func.lower(m.Exercise.name))).all()


@router.get("/exercises/{exercise_id}", response_model=s.ExerciseOut)
def get_exercise(
    exercise_id: int, _: User = Depends(workout_user), db: Session = Depends(get_db)
):
    return _exercise_or_404(db, exercise_id)


@router.post(
    "/exercises", response_model=s.ExerciseOut, status_code=status.HTTP_201_CREATED
)
def create_exercise(
    body: s.ExerciseIn, _: User = Depends(workout_user), db: Session = Depends(get_db)
):
    exercise = m.Exercise()
    apply_exercise(db, exercise, body)
    db.add(exercise)
    _commit_or_conflict(db, "exercise")
    db.refresh(exercise)
    return exercise


@router.put("/exercises/{exercise_id}", response_model=s.ExerciseOut)
def update_exercise(
    exercise_id: int,
    body: s.ExerciseIn,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    exercise = _exercise_or_404(db, exercise_id)
    apply_exercise(db, exercise, body)
    _commit_or_conflict(db, "exercise")
    db.refresh(exercise)
    return exercise


@router.delete("/exercises/{exercise_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exercise(
    exercise_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)
):
    exercise = _exercise_or_404(db, exercise_id)
    if db.scalar(select(exercise_in_use(exercise.id))):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This exercise is used by a workout, template or circuit",
        )
    db.delete(exercise)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── equipments ───────────────────────────────────────────────────────────────


def _equipment_or_404(db: Session, equipment_id: int) -> m.Equipment:
    equipment = db.get(m.Equipment, equipment_id)
    if equipment is None:
        raise not_found("Equipment")
    return equipment


@router.get("/equipments", response_model=list[s.EquipmentOut])
def list_equipments(_: User = Depends(workout_user), db: Session = Depends(get_db)):
    return db.scalars(select(m.Equipment).order_by(func.lower(m.Equipment.name))).all()


@router.post(
    "/equipments", response_model=s.EquipmentOut, status_code=status.HTTP_201_CREATED
)
def create_equipment(
    body: s.EquipmentIn, _: User = Depends(workout_user), db: Session = Depends(get_db)
):
    equipment = m.Equipment(name=body.name)
    db.add(equipment)
    _commit_or_conflict(db, "equipment")
    db.refresh(equipment)
    return equipment


@router.put("/equipments/{equipment_id}", response_model=s.EquipmentOut)
def update_equipment(
    equipment_id: int,
    body: s.EquipmentIn,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    equipment = _equipment_or_404(db, equipment_id)
    equipment.name = body.name
    _commit_or_conflict(db, "equipment")
    db.refresh(equipment)
    return equipment


@router.delete("/equipments/{equipment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_equipment(
    equipment_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)
):
    db.delete(_equipment_or_404(db, equipment_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
