"""The live session: one `in_progress` workout per user, edited set by set,
then finished (keeping only checked sets) or discarded."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.database import get_db
from core.models import User
from domains.workout import entries
from domains.workout import models as m
from domains.workout import schemas as s
from domains.workout.access import not_found, owned, workout_user

router = APIRouter(prefix="/session", tags=["workout"])


def _active(db: Session, user: User) -> m.Workout | None:
    return db.scalar(
        select(m.Workout).where(
            m.Workout.user_id == user.id, m.Workout.status == "in_progress"
        )
    )


def _active_or_404(db: Session, user: User) -> m.Workout:
    session = _active(db, user)
    if session is None:
        raise not_found("Session")
    return session


def _next_position(session: m.Workout) -> int:
    return len(entries.top_level(session))


def _session_row(db: Session, user: User, row_id: int) -> m.WorkoutExercise:
    session = _active_or_404(db, user)
    row = db.get(m.WorkoutExercise, row_id)
    if row is None or row.workout_id != session.id:
        raise not_found("Exercise")
    return row


def _session_set(db: Session, user: User, set_id: int) -> m.WorkoutSet:
    session = _active_or_404(db, user)
    set_ = db.get(m.WorkoutSet, set_id)
    if (
        set_ is None
        or db.get(m.WorkoutExercise, set_.workout_exercise_id).workout_id != session.id
    ):
        raise not_found("Set")
    return set_


def _check_exercise(db: Session, exercise_id: int) -> None:
    entries.check_exercises_exist(db, {exercise_id})


@router.get("", response_model=s.WorkoutOut | None)
def get_session(user: User = Depends(workout_user), db: Session = Depends(get_db)):
    session = _active(db, user)
    return entries.workout_out(session) if session else None


@router.post("", response_model=s.WorkoutOut, status_code=status.HTTP_201_CREATED)
def start_session(
    body: s.SessionStart,
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    if _active(db, user) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "A session is already running")
    session = m.Workout(
        user_id=user.id, status="in_progress", started_at=datetime.now(UTC)
    )
    if body.template_id is not None:
        template = owned(db, m.Template, body.template_id, user.id, "Template")
        # Exercises keep their planned sets; circuit members start without
        # sets, so the round counter starts at round 1.
        planned = [
            (
                entry.model_copy(
                    update={
                        "exercises": [
                            member.model_copy(update={"sets": []})
                            for member in entry.exercises
                        ]
                    }
                )
                if entry.type == "circuit"
                else entry
            )
            for entry in entries.entries_out(template)
        ]
        entries.build(session, entries.WORKOUT, planned)
    db.add(session)
    try:
        db.commit()
    except IntegrityError:
        # Started concurrently (uq_workouts_one_in_progress).
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A session is already running"
        ) from None
    db.refresh(session)
    return entries.workout_out(session)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def discard_session(user: User = Depends(workout_user), db: Session = Depends(get_db)):
    db.delete(_active_or_404(db, user))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/finish", response_model=s.WorkoutOut)
def finish_session(
    body: s.SessionFinish,
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    session = _active_or_404(db, user)
    checked = set(body.checked_set_ids)
    for row in session.exercises:
        row.sets = [set_ for set_ in row.sets if set_.id in checked]
    # Exercises left without sets go, then circuits left without exercises.
    session.exercises = [row for row in session.exercises if row.sets]
    for circuit in session.circuits:
        circuit.exercises = [row for row in circuit.exercises if row.sets]
    session.circuits = [c for c in session.circuits if c.exercises]

    now = datetime.now(UTC)
    session.ended_at = now
    session.date = body.date or session.started_at.astimezone(UTC).date()
    elapsed = (now - session.started_at).total_seconds()
    session.duration_minutes = min(max(1, round(elapsed / 60)), 1440)
    session.status = "completed"
    db.commit()
    db.refresh(session)
    return entries.workout_out(session)


# ── entries ──────────────────────────────────────────────────────────────────


@router.post(
    "/exercises",
    response_model=s.ExerciseEntryOut,
    status_code=status.HTTP_201_CREATED,
)
def add_exercise(
    body: s.SessionAddExercise,
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    session = _active_or_404(db, user)
    _check_exercise(db, body.exercise_id)
    row = m.WorkoutExercise(exercise_id=body.exercise_id, sets=[])
    if body.circuit_id is not None:
        circuit = db.get(m.WorkoutCircuit, body.circuit_id)
        if circuit is None or circuit.workout_id != session.id:
            raise not_found("Circuit")
        row.position = len(circuit.exercises)
        circuit.exercises.append(row)
    else:
        row.position = _next_position(session)
    session.exercises.append(row)
    db.commit()
    db.refresh(row)
    return entries.exercise_out(row)


@router.delete("/exercises/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_exercise(
    row_id: int, user: User = Depends(workout_user), db: Session = Depends(get_db)
):
    db.delete(_session_row(db, user, row_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/circuits",
    response_model=s.CircuitEntryOut,
    status_code=status.HTTP_201_CREATED,
)
def add_circuit(
    body: s.SessionAddCircuit,
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    session = _active_or_404(db, user)
    entries.check_exercises_exist(db, set(body.exercise_ids))
    circuit = m.WorkoutCircuit(
        name=body.name,
        duration_minutes=body.duration_minutes,
        rounds=body.rounds,
        position=_next_position(session),
    )
    for i, exercise_id in enumerate(body.exercise_ids):
        row = m.WorkoutExercise(exercise_id=exercise_id, position=i, sets=[])
        circuit.exercises.append(row)
        session.exercises.append(row)
    session.circuits.append(circuit)
    db.commit()
    db.refresh(circuit)
    return entries.circuit_out(circuit)


@router.delete("/circuits/{circuit_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_circuit(
    circuit_id: int, user: User = Depends(workout_user), db: Session = Depends(get_db)
):
    session = _active_or_404(db, user)
    circuit = db.get(m.WorkoutCircuit, circuit_id)
    if circuit is None or circuit.workout_id != session.id:
        raise not_found("Circuit")
    db.delete(circuit)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── sets ─────────────────────────────────────────────────────────────────────


@router.post(
    "/exercises/{row_id}/sets",
    response_model=s.SetOut,
    status_code=status.HTTP_201_CREATED,
)
def add_set(
    row_id: int,
    body: s.SetIn,
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    row = _session_row(db, user, row_id)
    set_ = m.WorkoutSet(**body.model_dump())
    row.sets.append(set_)
    db.commit()
    db.refresh(set_)
    return set_


@router.put("/sets/{set_id}", response_model=s.SetOut)
def update_set(
    set_id: int,
    body: s.SetIn,
    user: User = Depends(workout_user),
    db: Session = Depends(get_db),
):
    set_ = _session_set(db, user, set_id)
    for field, value in body.model_dump().items():
        setattr(set_, field, value)
    db.commit()
    db.refresh(set_)
    return set_


@router.delete("/sets/{set_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_set(
    set_id: int, user: User = Depends(workout_user), db: Session = Depends(get_db)
):
    db.delete(_session_set(db, user, set_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
