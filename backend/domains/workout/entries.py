"""Building and serializing entries, shared by workouts, templates and saved
circuits (see models.py: the three use the same relationship names)."""

from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from domains.workout import models as m
from domains.workout import schemas as s


@dataclass(frozen=True)
class Kind:
    """The tables holding one kind of container's circuits, exercises and sets."""

    circuit: type | None
    exercise: type
    set: type


WORKOUT = Kind(m.WorkoutCircuit, m.WorkoutExercise, m.WorkoutSet)
TEMPLATE = Kind(m.TemplateCircuit, m.TemplateExercise, m.TemplateSet)
SAVED_CIRCUIT = Kind(None, m.SavedCircuitExercise, m.SavedCircuitSet)


def set_values(set_) -> dict:
    return {field: getattr(set_, field) for field in s.SET_FIELDS}


# ── build ────────────────────────────────────────────────────────────────────


def _exercise_row(kind: Kind, exercise_id: int, sets, position: int):
    return kind.exercise(
        exercise_id=exercise_id,
        position=position,
        sets=[kind.set(**set_values(set_)) for set_ in sets],
    )


def build(container, kind: Kind, entries: list) -> None:
    """Replace a workout's or template's entries. `entries` are `EntryIn`s, or
    any objects with the same attributes (`exercise_id`, `sets`, …)."""
    container.exercises = []
    container.circuits = []
    for position, entry in enumerate(entries):
        if entry.type == "circuit":
            circuit = kind.circuit(
                name=entry.name,
                duration_minutes=entry.duration_minutes,
                rounds=entry.rounds,
                position=position,
            )
            for i, member in enumerate(entry.exercises):
                row = _exercise_row(kind, member.exercise_id, member.sets, i)
                circuit.exercises.append(row)
                container.exercises.append(row)
            container.circuits.append(circuit)
        else:
            container.exercises.append(
                _exercise_row(kind, entry.exercise_id, entry.sets, position)
            )


def build_members(circuit, kind: Kind, members: list) -> None:
    """Replace a saved circuit's exercises."""
    circuit.exercises = [
        _exercise_row(kind, member.exercise_id, member.sets, i)
        for i, member in enumerate(members)
    ]


def exercise_ids(entries: list) -> set[int]:
    ids: set[int] = set()
    for entry in entries:
        if getattr(entry, "type", "exercise") == "circuit":
            ids.update(member.exercise_id for member in entry.exercises)
        else:
            ids.add(entry.exercise_id)
    return ids


def check_exercises_exist(db: Session, ids: set[int]) -> None:
    found = set(db.scalars(select(m.Exercise.id).where(m.Exercise.id.in_(ids))))
    if ids - found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exercise not found")


def name_taken(db: Session, model, user_id: int, name: str, exclude_id=None) -> bool:
    """Whether the user already has a template/saved circuit with this name."""
    query = select(model.id).where(
        model.user_id == user_id, func.lower(model.name) == name.lower()
    )
    if exclude_id is not None:
        query = query.where(model.id != exclude_id)
    return db.scalar(query) is not None


# ── serialize ────────────────────────────────────────────────────────────────


def exercise_out(row) -> s.ExerciseEntryOut:
    return s.ExerciseEntryOut(
        id=row.id,
        exercise_id=row.exercise_id,
        exercise=s.ExerciseOut.model_validate(row.exercise),
        sets=[s.SetOut.model_validate(set_) for set_ in row.sets],
    )


def circuit_out(circuit) -> s.CircuitEntryOut:
    return s.CircuitEntryOut(
        id=circuit.id,
        name=circuit.name,
        duration_minutes=circuit.duration_minutes,
        rounds=circuit.rounds,
        exercises=[exercise_out(row) for row in circuit.exercises],
    )


def top_level(container) -> list:
    """Top-level exercise rows and circuits, in their shared position order."""
    items = [row for row in container.exercises if row.circuit_id is None]
    items += list(container.circuits)
    return sorted(items, key=lambda item: item.position)


def entries_out(container) -> list:
    # Exercise rows have sets, circuits don't.
    return [
        exercise_out(item) if hasattr(item, "sets") else circuit_out(item)
        for item in top_level(container)
    ]


def workout_out(workout: m.Workout) -> s.WorkoutOut:
    return s.WorkoutOut(
        id=workout.id,
        user_id=workout.user_id,
        status=workout.status,
        date=workout.date,
        duration_minutes=workout.duration_minutes,
        started_at=workout.started_at,
        ended_at=workout.ended_at,
        exercises=entries_out(workout),
    )


def template_out(template: m.Template) -> s.TemplateOut:
    return s.TemplateOut(
        id=template.id,
        user_id=template.user_id,
        name=template.name,
        exercises=entries_out(template),
    )


def saved_circuit_out(circuit: m.SavedCircuit) -> s.SavedCircuitOut:
    return s.SavedCircuitOut(
        id=circuit.id,
        name=circuit.name,
        duration_minutes=circuit.duration_minutes,
        rounds=circuit.rounds,
        exercises=[exercise_out(row) for row in circuit.exercises],
    )
