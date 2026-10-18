"""Admin page: catalog files, multi-user workout/template/circuit files (matched to
`core.users` by email, used to reload prod at cutover), delete-all."""

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from core.database import get_db
from core.deps import require_admin
from core.models import User
from domains.workout import models as m
from domains.workout import schemas as s
from domains.workout import transfer
from domains.workout.catalog import exercise_in_use
from domains.workout.routers.transfer import (
    user_circuits_file,
    user_templates_file,
    user_workouts_file,
)

router = APIRouter(prefix="/admin", tags=["workout"])

UserIds = Query(default=[], max_length=1000)


def _users(db: Session, user_ids: list[int]) -> list[User]:
    if not user_ids:
        return []
    return db.scalars(select(User).where(User.id.in_(user_ids)).order_by(User.id)).all()


def _users_by_email(db: Session, emails: list[str]) -> dict[str, User]:
    users = db.scalars(select(User).where(User.email.in_([e.lower() for e in emails])))
    return {user.email: user for user in users}


def _import_per_user(db: Session, files: list, key: str, importer) -> s.ImportResult:
    """Each file's `key` list imported for the user of its email."""
    result = s.ImportResult()
    users = _users_by_email(db, [f.user_email for f in files])
    for f in files:
        items = getattr(f, key)
        user = users.get(f.user_email.lower())
        if user is None:
            result.skipped += len(items)
            result.ignored.append(f"{f.user_email} (no such user)")
        else:
            importer(db, user.id, items, result)
    db.commit()
    return result


# ── workouts, templates and circuits of several users ──────────────────────────────────


@router.get("/workouts/export")
def export_workouts(
    user_ids: list[int] = UserIds,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return [
        {"user_email": u.email, "workouts": user_workouts_file(db, u.id)}
        for u in _users(db, user_ids)
    ]


@router.post("/workouts/import", response_model=s.ImportResult)
def import_workouts(
    files: list[s.UserWorkoutsFile],
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return _import_per_user(db, files, "workouts", transfer.import_workouts)


@router.get("/templates/export")
def export_templates(
    user_ids: list[int] = UserIds,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return [
        {"user_email": u.email, "templates": user_templates_file(db, u.id)}
        for u in _users(db, user_ids)
    ]


@router.post("/templates/import", response_model=s.ImportResult)
def import_templates(
    files: list[s.UserTemplatesFile],
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return _import_per_user(db, files, "templates", transfer.import_templates)


@router.get("/circuits/export")
def export_circuits(
    user_ids: list[int] = UserIds,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return [
        {"user_email": u.email, "circuits": user_circuits_file(db, u.id)}
        for u in _users(db, user_ids)
    ]


@router.post("/circuits/import", response_model=s.ImportResult)
def import_circuits(
    files: list[s.UserCircuitsFile],
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return _import_per_user(db, files, "circuits", transfer.import_circuits)


@router.delete("/workouts", status_code=status.HTTP_204_NO_CONTENT)
def delete_workouts(
    user_ids: list[int] = UserIds,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Every workout of these users, live sessions included."""
    db.execute(delete(m.Workout).where(m.Workout.user_id.in_(user_ids)))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/templates", status_code=status.HTTP_204_NO_CONTENT)
def delete_templates(
    user_ids: list[int] = UserIds,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    db.execute(delete(m.Template).where(m.Template.user_id.in_(user_ids)))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/circuits", status_code=status.HTTP_204_NO_CONTENT)
def delete_circuits(
    user_ids: list[int] = UserIds,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    db.execute(delete(m.SavedCircuit).where(m.SavedCircuit.user_id.in_(user_ids)))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── catalog ──────────────────────────────────────────────────────────────────


@router.get("/exercises/export")
def export_exercises(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    exercises = db.scalars(select(m.Exercise).order_by(func.lower(m.Exercise.name)))
    return [transfer.exercise_file(e) for e in exercises]


@router.post("/exercises/import", response_model=s.ImportResult)
def import_exercises(
    files: list[s.ExerciseFile],
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    result = transfer.import_exercises(db, files)
    db.commit()
    return result


@router.get("/equipments/export", response_model=list[str])
def export_equipments(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    return db.scalars(
        select(m.Equipment.name).order_by(func.lower(m.Equipment.name))
    ).all()


@router.post("/equipments/import", response_model=s.ImportResult)
def import_equipments(
    names: list[str], _: User = Depends(require_admin), db: Session = Depends(get_db)
):
    result = transfer.import_equipments(db, names)
    db.commit()
    return result


@router.delete("/exercises", status_code=status.HTTP_204_NO_CONTENT)
def delete_exercises(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    """The whole catalog of exercises; refused while any is used."""
    if db.scalar(select(exercise_in_use(m.Exercise.id))):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Some exercises are used by workouts, templates or circuits",
        )
    db.execute(delete(m.Exercise))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/equipments", status_code=status.HTTP_204_NO_CONTENT)
def delete_equipments(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    db.execute(delete(m.Equipment))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
