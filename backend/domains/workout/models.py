"""Tables in the `workout` schema (see data-model.md `workout`).

Workouts, templates and saved circuits share one shape: ordered entries, each
an exercise with its sets or a circuit holding exercises with their sets. Each
of the three has its own tables, with the same relationship names (`exercises`,
`circuits`, `sets`, `exercise`) so `entries.py` can build and serialize any of
them.
"""

from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Double,
    ForeignKey,
    Index,
    SmallInteger,
    Table,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from domains.workout.muscles import MUSCLES

SCHEMA = {"schema": "workout"}
EXERCISE_TYPES = ("strength", "cardio")
WORKOUT_STATUSES = ("in_progress", "completed")


# ── catalog ──────────────────────────────────────────────────────────────────

exercise_equipments = Table(
    "exercise_equipments",
    Base.metadata,
    Column(
        "exercise_id",
        ForeignKey("workout.exercises.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "equipment_id",
        ForeignKey("workout.equipments.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    **SCHEMA,
)


class Equipment(Base):
    __tablename__ = "equipments"
    __table_args__ = SCHEMA

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)


class ExerciseMuscle(Base):
    __tablename__ = "exercise_muscles"
    __table_args__ = (
        CheckConstraint(f"muscle IN {MUSCLES}", name="muscle"),
        CheckConstraint("intensity BETWEEN 1 AND 3", name="intensity"),
        SCHEMA,
    )

    exercise_id: Mapped[int] = mapped_column(
        ForeignKey("workout.exercises.id", ondelete="CASCADE"), primary_key=True
    )
    muscle: Mapped[str] = mapped_column(Text, primary_key=True)
    intensity: Mapped[int] = mapped_column(SmallInteger)

    @property
    def name(self) -> str:
        return self.muscle


class Exercise(Base):
    """Shared catalog row; `type` is only a label (any set field works)."""

    __tablename__ = "exercises"
    __table_args__ = (
        CheckConstraint(f"type IN {EXERCISE_TYPES}", name="type"),
        SCHEMA,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(Text)

    muscles: Mapped[list[ExerciseMuscle]] = relationship(
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        order_by=ExerciseMuscle.muscle,
    )
    equipments: Mapped[list[Equipment]] = relationship(
        secondary=exercise_equipments,
        lazy="selectin",
        order_by=func.lower(Equipment.name),
    )


Index("uq_exercises_name_lower", func.lower(Exercise.name), unique=True)
Index("uq_equipments_name_lower", func.lower(Equipment.name), unique=True)


# ── shared column sets ───────────────────────────────────────────────────────


class SetValues:
    """A set: every field optional (strength, cardio or both). Ordered by id."""

    id: Mapped[int] = mapped_column(primary_key=True)
    reps: Mapped[int | None]
    weight_kg: Mapped[float | None] = mapped_column(Double)
    duration_s: Mapped[int | None]
    distance_m: Mapped[float | None] = mapped_column(Double)
    speed_kmh: Mapped[float | None] = mapped_column(Double)
    difficulty: Mapped[float | None] = mapped_column(Double)


class CircuitValues:
    name: Mapped[str | None] = mapped_column(Text)
    duration_minutes: Mapped[int | None]
    rounds: Mapped[int | None]


def _sets(model: str):
    return relationship(
        model,
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        order_by=f"{model}.id",
    )


def _ordered(model: str, **kwargs):
    return relationship(
        model,
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        order_by=f"{model}.position",
        **kwargs,
    )


def _exercise():
    # No cascade from the catalog: an exercise in use can't be deleted.
    return relationship(Exercise, lazy="selectin")


# ── workouts ─────────────────────────────────────────────────────────────────


class Workout(Base):
    __tablename__ = "workouts"
    __table_args__ = (
        CheckConstraint(f"status IN {WORKOUT_STATUSES}", name="status"),
        # One live session per user.
        Index(
            "uq_workouts_one_in_progress",
            "user_id",
            unique=True,
            postgresql_where=text("status = 'in_progress'"),
        ),
        Index("ix_workouts_user_id_date", "user_id", "date"),
        SCHEMA,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("core.users.id", ondelete="CASCADE")
    )
    status: Mapped[str] = mapped_column(
        Text, default="completed", server_default="completed"
    )
    # Null only while in progress.
    date: Mapped[date | None]
    duration_minutes: Mapped[int | None]
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Every exercise row, top-level ones and circuit members alike.
    exercises: Mapped[list[WorkoutExercise]] = _ordered("WorkoutExercise")
    circuits: Mapped[list[WorkoutCircuit]] = _ordered("WorkoutCircuit")


class WorkoutCircuit(CircuitValues, Base):
    __tablename__ = "workout_circuits"
    __table_args__ = SCHEMA

    id: Mapped[int] = mapped_column(primary_key=True)
    workout_id: Mapped[int] = mapped_column(
        ForeignKey("workout.workouts.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int]

    exercises: Mapped[list[WorkoutExercise]] = _ordered("WorkoutExercise")


class WorkoutExercise(Base):
    __tablename__ = "workout_exercises"
    __table_args__ = SCHEMA

    id: Mapped[int] = mapped_column(primary_key=True)
    workout_id: Mapped[int] = mapped_column(
        ForeignKey("workout.workouts.id", ondelete="CASCADE"), index=True
    )
    exercise_id: Mapped[int] = mapped_column(ForeignKey("workout.exercises.id"))
    circuit_id: Mapped[int | None] = mapped_column(
        ForeignKey("workout.workout_circuits.id", ondelete="CASCADE"), index=True
    )
    # Among the workout's top-level entries, or inside its circuit.
    position: Mapped[int]

    exercise: Mapped[Exercise] = _exercise()
    sets: Mapped[list[WorkoutSet]] = _sets("WorkoutSet")


class WorkoutSet(SetValues, Base):
    __tablename__ = "workout_sets"
    __table_args__ = SCHEMA

    workout_exercise_id: Mapped[int] = mapped_column(
        ForeignKey("workout.workout_exercises.id", ondelete="CASCADE"), index=True
    )


# ── templates ────────────────────────────────────────────────────────────────


class Template(Base):
    __tablename__ = "templates"
    __table_args__ = SCHEMA

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("core.users.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(Text)

    exercises: Mapped[list[TemplateExercise]] = _ordered("TemplateExercise")
    circuits: Mapped[list[TemplateCircuit]] = _ordered("TemplateCircuit")


class TemplateCircuit(CircuitValues, Base):
    __tablename__ = "template_circuits"
    __table_args__ = SCHEMA

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int] = mapped_column(
        ForeignKey("workout.templates.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int]

    exercises: Mapped[list[TemplateExercise]] = _ordered("TemplateExercise")


class TemplateExercise(Base):
    __tablename__ = "template_exercises"
    __table_args__ = SCHEMA

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int] = mapped_column(
        ForeignKey("workout.templates.id", ondelete="CASCADE"), index=True
    )
    exercise_id: Mapped[int] = mapped_column(ForeignKey("workout.exercises.id"))
    circuit_id: Mapped[int | None] = mapped_column(
        ForeignKey("workout.template_circuits.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int]

    exercise: Mapped[Exercise] = _exercise()
    sets: Mapped[list[TemplateSet]] = _sets("TemplateSet")


class TemplateSet(SetValues, Base):
    __tablename__ = "template_sets"
    __table_args__ = SCHEMA

    template_exercise_id: Mapped[int] = mapped_column(
        ForeignKey("workout.template_exercises.id", ondelete="CASCADE"), index=True
    )


# ── saved circuits ───────────────────────────────────────────────────────────


class SavedCircuit(CircuitValues, Base):
    """A reusable circuit, inserted into workouts, templates and sessions."""

    __tablename__ = "saved_circuits"
    __table_args__ = SCHEMA

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("core.users.id", ondelete="CASCADE")
    )

    exercises: Mapped[list[SavedCircuitExercise]] = _ordered("SavedCircuitExercise")


class SavedCircuitExercise(Base):
    __tablename__ = "saved_circuit_exercises"
    __table_args__ = SCHEMA

    id: Mapped[int] = mapped_column(primary_key=True)
    circuit_id: Mapped[int] = mapped_column(
        ForeignKey("workout.saved_circuits.id", ondelete="CASCADE"), index=True
    )
    exercise_id: Mapped[int] = mapped_column(ForeignKey("workout.exercises.id"))
    position: Mapped[int]

    exercise: Mapped[Exercise] = _exercise()
    sets: Mapped[list[SavedCircuitSet]] = _sets("SavedCircuitSet")


class SavedCircuitSet(SetValues, Base):
    __tablename__ = "saved_circuit_sets"
    __table_args__ = SCHEMA

    circuit_exercise_id: Mapped[int] = mapped_column(
        ForeignKey("workout.saved_circuit_exercises.id", ondelete="CASCADE"),
        index=True,
    )


# Template and saved-circuit names are unique per user, case-insensitively.
Index(
    "uq_templates_user_id_name_lower",
    Template.user_id,
    func.lower(Template.name),
    unique=True,
)
Index(
    "uq_saved_circuits_user_id_name_lower",
    SavedCircuit.user_id,
    func.lower(SavedCircuit.name),
    unique=True,
)
