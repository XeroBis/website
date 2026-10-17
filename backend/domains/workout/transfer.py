"""Import/export in the old app's JSON formats (see features.md "File formats").

Exercises are referenced by name, matched case-insensitively. Imports skip
(and report) items naming an unknown exercise, workouts identical to one the
user already has, and templates/circuits whose name the user already uses.
"""

from types import SimpleNamespace

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from domains.workout import entries
from domains.workout import models as m
from domains.workout import schemas as s
from domains.workout.catalog import apply_exercise

# ── export ───────────────────────────────────────────────────────────────────


def _sets_file(row) -> list[dict]:
    return [
        {k: v for k, v in entries.set_values(set_).items() if v is not None}
        for set_ in row.sets
    ]


def _member_file(row) -> dict:
    return {
        "type": "exercise",
        "exercise_name": row.exercise.name,
        "sets": _sets_file(row),
    }


def _circuit_fields(circuit) -> dict:
    return {
        "name": circuit.name,
        "duration_minutes": circuit.duration_minutes,
        "rounds": circuit.rounds,
    }


def _entries_file(container) -> list[dict]:
    result = []
    for item in entries.top_level(container):
        if hasattr(item, "sets"):
            result.append(_member_file(item))
        else:
            result.append(
                {"type": "circuit", **_circuit_fields(item)}
                | {"exercises": [_member_file(row) for row in item.exercises]}
            )
    return result


def workout_file(workout: m.Workout) -> dict:
    return {
        "date": workout.date.isoformat(),
        "duration_minutes": workout.duration_minutes,
        "exercises": _entries_file(workout),
    }


def template_file(template: m.Template) -> dict:
    return {"name": template.name, "exercises": _entries_file(template)}


def circuit_file(circuit: m.SavedCircuit) -> dict:
    return _circuit_fields(circuit) | {
        "exercises": [_member_file(row) for row in circuit.exercises]
    }


# ── import helpers ───────────────────────────────────────────────────────────


def _names(file_entries) -> set[str]:
    names: set[str] = set()
    for entry in file_entries:
        if entry.type == "circuit":
            names.update(member.exercise_name for member in entry.exercises)
        else:
            names.add(entry.exercise_name)
    return names


def exercise_ids_by_name(db: Session, names: set[str]) -> dict[str, int]:
    """Lowercased name -> exercise id, for the names that exist."""
    if not names:
        return {}
    rows = db.execute(
        select(func.lower(m.Exercise.name), m.Exercise.id).where(
            func.lower(m.Exercise.name).in_([n.lower() for n in names])
        )
    )
    return dict(rows.all())


def _missing(file_entries, ids: dict[str, int]) -> str | None:
    missing = sorted(n for n in _names(file_entries) if n.lower() not in ids)
    return missing[0] if missing else None


def _resolved(file_entries, ids: dict[str, int]) -> list:
    """File entries -> objects `entries.build` accepts (exercise ids)."""

    def member(f):
        return SimpleNamespace(exercise_id=ids[f.exercise_name.lower()], sets=f.sets)

    result = []
    for entry in file_entries:
        if entry.type == "circuit":
            result.append(
                SimpleNamespace(
                    type="circuit",
                    name=entry.name,
                    duration_minutes=entry.duration_minutes,
                    rounds=entry.rounds,
                    exercises=[member(f) for f in entry.exercises],
                )
            )
        else:
            result.append(SimpleNamespace(type="exercise", **vars(member(entry))))
    return result


def _set_key(set_) -> tuple:
    return tuple(
        None if v is None else float(v) for v in entries.set_values(set_).values()
    )


def _member_key(member) -> tuple:
    return (member.exercise_id, tuple(_set_key(st) for st in member.sets))


def _entries_key(items) -> tuple:
    """Comparable form of entries, from resolved file entries or DB rows."""
    key = []
    for item in items:
        # Exercise rows (and resolved file exercises) have sets, circuits don't.
        if not hasattr(item, "sets"):
            key.append(
                (
                    "circuit",
                    item.name,
                    item.duration_minutes,
                    item.rounds,
                    tuple(_member_key(row) for row in item.exercises),
                )
            )
        else:
            key.append(("exercise", *_member_key(item)))
    return tuple(key)


def _workout_key(day, duration, items) -> tuple:
    return (day, duration, _entries_key(items))


# ── imports ──────────────────────────────────────────────────────────────────


def import_workouts(
    db: Session, user_id: int, files: list[s.WorkoutFile], result: s.ImportResult
) -> None:
    """Adds to `result`; the caller commits."""
    days = {f.date for f in files}
    seen = {
        _workout_key(w.date, w.duration_minutes, entries.top_level(w))
        for w in db.scalars(
            select(m.Workout).where(
                m.Workout.user_id == user_id,
                m.Workout.status == "completed",
                m.Workout.date.in_(days),
            )
        )
    }
    ids = exercise_ids_by_name(db, {n for f in files for n in _names(f.exercises)})
    for f in files:
        missing = _missing(f.exercises, ids)
        if missing:
            result.skipped += 1
            result.ignored.append(f"{f.date} (unknown exercise: {missing})")
            continue
        resolved = _resolved(f.exercises, ids)
        key = _workout_key(f.date, f.duration_minutes, resolved)
        if key in seen:
            result.skipped += 1
            result.ignored.append(f"{f.date} (already there)")
            continue
        seen.add(key)
        workout = m.Workout(
            user_id=user_id,
            status="completed",
            date=f.date,
            duration_minutes=f.duration_minutes,
        )
        entries.build(workout, entries.WORKOUT, resolved)
        db.add(workout)
        result.created += 1


def _taken_names(db: Session, model, user_id: int) -> set[str]:
    return {
        name.lower()
        for name in db.scalars(select(model.name).where(model.user_id == user_id))
    }


def import_templates(
    db: Session, user_id: int, files: list[s.TemplateFile], result: s.ImportResult
) -> None:
    taken = _taken_names(db, m.Template, user_id)
    ids = exercise_ids_by_name(db, {n for f in files for n in _names(f.exercises)})
    for f in files:
        missing = _missing(f.exercises, ids)
        if missing:
            result.skipped += 1
            result.ignored.append(f"{f.name} (unknown exercise: {missing})")
        elif f.name.lower() in taken:
            result.skipped += 1
            result.ignored.append(f"{f.name} (name already used)")
        else:
            taken.add(f.name.lower())
            template = m.Template(user_id=user_id, name=f.name)
            entries.build(template, entries.TEMPLATE, _resolved(f.exercises, ids))
            db.add(template)
            result.created += 1


def import_circuits(
    db: Session, user_id: int, files: list[s.SavedCircuitFile], result: s.ImportResult
) -> None:
    taken = _taken_names(db, m.SavedCircuit, user_id)
    ids = exercise_ids_by_name(
        db, {e.exercise_name for f in files for e in f.exercises}
    )
    for f in files:
        missing = sorted(
            e.exercise_name for e in f.exercises if e.exercise_name.lower() not in ids
        )
        if missing:
            result.skipped += 1
            result.ignored.append(f"{f.name} (unknown exercise: {missing[0]})")
        elif f.name.lower() in taken:
            result.skipped += 1
            result.ignored.append(f"{f.name} (name already used)")
        else:
            taken.add(f.name.lower())
            circuit = m.SavedCircuit(
                user_id=user_id,
                name=f.name,
                duration_minutes=f.duration_minutes,
                rounds=f.rounds,
            )
            entries.build_members(
                circuit,
                entries.SAVED_CIRCUIT,
                [
                    SimpleNamespace(
                        exercise_id=ids[e.exercise_name.lower()], sets=e.sets
                    )
                    for e in f.exercises
                ],
            )
            db.add(circuit)
            result.created += 1


# ── catalog (admin) ──────────────────────────────────────────────────────────


def exercise_file(exercise: m.Exercise) -> dict:
    return {
        "name": exercise.name,
        "type": exercise.type,
        "muscles": [
            {"name": mu.muscle, "intensity": mu.intensity} for mu in exercise.muscles
        ],
        "equipments": [eq.name for eq in exercise.equipments],
    }


def import_exercises(db: Session, files: list[s.ExerciseFile]) -> s.ImportResult:
    """Creates or updates by name; a row failing validation is skipped."""
    result = s.ImportResult()
    by_name = {
        exercise.name.lower(): exercise for exercise in db.scalars(select(m.Exercise))
    }
    for f in files:
        try:
            body = s.ExerciseIn.model_validate(f.model_dump())
        except ValidationError as exc:
            result.skipped += 1
            reason = exc.errors()[0]["msg"].removeprefix("Value error, ")
            result.ignored.append(f"{f.name} ({reason})")
            continue
        exercise = by_name.get(body.name.lower())
        if exercise is None:
            exercise = by_name[body.name.lower()] = m.Exercise()
            db.add(exercise)
            result.created += 1
        else:
            result.updated += 1
        apply_exercise(db, exercise, body)
        db.flush()
    return result


def import_equipments(db: Session, names: list[str]) -> s.ImportResult:
    result = s.ImportResult()
    taken = {name.lower() for name in db.scalars(select(m.Equipment.name))}
    for raw in names:
        name = raw.strip()
        if not name:
            continue
        if len(name) > 100:
            result.skipped += 1
            result.ignored.append(f"{name[:40]}… (name too long)")
        elif name.lower() in taken:
            result.skipped += 1
            result.ignored.append(f"{name} (already there)")
        else:
            taken.add(name.lower())
            db.add(m.Equipment(name=name))
            result.created += 1
    return result
