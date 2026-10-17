"""Catalog writes shared by the exercise routes and the admin import."""

from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from domains.workout import models as m
from domains.workout import schemas as s


def equipments_by_name(db: Session, names: list[str]) -> list[m.Equipment]:
    """Existing equipments matched case-insensitively; the others are created."""
    if not names:
        return []
    existing = {
        eq.name.lower(): eq
        for eq in db.scalars(
            select(m.Equipment).where(
                func.lower(m.Equipment.name).in_([n.lower() for n in names])
            )
        )
    }
    result = []
    for name in names:
        eq = existing.get(name.lower())
        if eq is None:
            eq = existing[name.lower()] = m.Equipment(name=name)
            db.add(eq)
        result.append(eq)
    return result


def apply_exercise(db: Session, exercise: m.Exercise, body: s.ExerciseIn) -> None:
    exercise.name = body.name
    exercise.type = body.type
    exercise.muscles = [
        m.ExerciseMuscle(muscle=mu.name, intensity=mu.intensity) for mu in body.muscles
    ]
    exercise.equipments = equipments_by_name(db, body.equipments)


def exercise_in_use(exercise_id_column):
    """SQL condition: the exercise is used by a workout, template or circuit."""
    return or_(
        *(
            exists().where(model.exercise_id == exercise_id_column)
            for model in (m.WorkoutExercise, m.TemplateExercise, m.SavedCircuitExercise)
        )
    )
