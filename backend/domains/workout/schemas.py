"""Request/response bodies of `/api/workout` (see features.md "Workout")."""

import datetime as dt
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from domains.workout.muscles import MUSCLES

ExerciseType = Literal["strength", "cardio"]
Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]


def _blank_to_none(value):
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


OptionalName = Annotated[
    Annotated[str, StringConstraints(max_length=100)] | None,
    BeforeValidator(_blank_to_none),
]
CircuitMinutes = Annotated[int, Field(ge=1, le=1440)]
Rounds = Annotated[int, Field(ge=1, le=1000)]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ── catalog ──────────────────────────────────────────────────────────────────


class MuscleIn(BaseModel):
    name: str
    intensity: int = Field(ge=1, le=3)

    @field_validator("name")
    @classmethod
    def _known(cls, name: str) -> str:
        if name not in MUSCLES:
            raise ValueError(f"Unknown muscle: {name}")
        return name


class MuscleOut(ORM):
    name: str
    intensity: int


class EquipmentIn(BaseModel):
    name: Name


class EquipmentOut(ORM):
    id: int
    name: str


class ExerciseIn(BaseModel):
    name: Name
    type: ExerciseType
    muscles: list[MuscleIn] = Field(default=[], max_length=30)
    equipments: list[Name] = Field(default=[], max_length=20)

    @model_validator(mode="after")
    def _no_repeats(self):
        names = [m.name for m in self.muscles]
        if len(names) != len(set(names)):
            raise ValueError("A muscle is listed twice")
        # Equipment repeats (case-insensitive) are just dropped.
        seen: dict[str, str] = {}
        for name in self.equipments:
            seen.setdefault(name.lower(), name)
        self.equipments = list(seen.values())
        return self


class ExerciseOut(ORM):
    id: int
    name: str
    type: ExerciseType
    muscles: list[MuscleOut]
    equipments: list[EquipmentOut]


# ── sets and entries ─────────────────────────────────────────────────────────


class SetIn(BaseModel):
    reps: int | None = Field(default=None, ge=1, le=10000)
    weight_kg: float | None = Field(default=None, ge=-1500, le=1500)
    duration_s: int | None = Field(default=None, ge=1, le=86400)
    distance_m: float | None = Field(default=None, ge=0, le=100000)
    speed_kmh: float | None = Field(default=None, ge=0, le=500)
    difficulty: float | None = Field(default=None, ge=0, le=100)


SET_FIELDS = tuple(SetIn.model_fields)


class SetOut(SetIn, ORM):
    id: int


class MemberIn(BaseModel):
    """An exercise with its sets (inside a circuit, or as a top-level entry)."""

    exercise_id: int
    sets: list[SetIn] = Field(min_length=1, max_length=100)


class ExerciseEntryIn(MemberIn):
    type: Literal["exercise"]


class CircuitFields(BaseModel):
    name: OptionalName = None
    duration_minutes: CircuitMinutes | None = None
    rounds: Rounds | None = None


class CircuitEntryIn(CircuitFields):
    type: Literal["circuit"]
    exercises: list[MemberIn] = Field(min_length=1, max_length=50)


EntryIn = Annotated[ExerciseEntryIn | CircuitEntryIn, Field(discriminator="type")]
Entries = Annotated[list[EntryIn], Field(min_length=1, max_length=100)]


class ExerciseEntryOut(BaseModel):
    id: int
    type: Literal["exercise"] = "exercise"
    exercise_id: int
    exercise: ExerciseOut
    sets: list[SetOut]


class CircuitEntryOut(BaseModel):
    id: int
    type: Literal["circuit"] = "circuit"
    name: str | None
    duration_minutes: int | None
    rounds: int | None
    exercises: list[ExerciseEntryOut]


EntryOut = Annotated[ExerciseEntryOut | CircuitEntryOut, Field(discriminator="type")]


# ── workouts, templates, saved circuits ──────────────────────────────────────


class WorkoutIn(BaseModel):
    date: dt.date
    duration_minutes: int = Field(ge=1, le=1440)
    exercises: Entries


class WorkoutOut(BaseModel):
    id: int
    user_id: int
    status: Literal["in_progress", "completed"]
    date: dt.date | None
    duration_minutes: int | None
    started_at: dt.datetime | None
    ended_at: dt.datetime | None
    exercises: list[EntryOut]


class TemplateIn(BaseModel):
    name: Name
    exercises: Entries


class TemplateOut(BaseModel):
    id: int
    user_id: int
    name: str
    exercises: list[EntryOut]


class SavedCircuitIn(CircuitFields):
    name: Name
    exercises: list[MemberIn] = Field(min_length=1, max_length=50)


class SavedCircuitOut(BaseModel):
    id: int
    type: Literal["circuit"] = "circuit"
    name: str
    duration_minutes: int | None
    rounds: int | None
    exercises: list[ExerciseEntryOut]


class WorkoutUser(ORM):
    id: int
    pseudo: str


# ── live session ─────────────────────────────────────────────────────────────


class SessionStart(BaseModel):
    template_id: int | None = None


class SessionAddExercise(BaseModel):
    exercise_id: int
    circuit_id: int | None = None


class SessionAddCircuit(CircuitFields):
    exercise_ids: list[int] = Field(default=[], max_length=50)


class SessionFinish(BaseModel):
    checked_set_ids: list[int] = []
    # The browser's local date; else the start's UTC date.
    date: dt.date | None = None


# ── stats ────────────────────────────────────────────────────────────────────


class StatsDay(BaseModel):
    date: dt.date
    workout_ids: list[int]


class StatsWeek(BaseModel):
    week_start: dt.date
    workouts: int
    volume_kg: float


class NameCount(BaseModel):
    name: str
    count: int


class StatsMuscle(BaseModel):
    name: str
    total: int
    exercises: list[NameCount]


class ProgressPoint(BaseModel):
    date: dt.date
    max_weight_kg: float
    est_1rm_kg: float


class Progression(BaseModel):
    exercise_id: int
    name: str
    points: list[ProgressPoint]


class Stats(BaseModel):
    date_from: dt.date | None
    date_to: dt.date | None
    workouts: int
    exercises: int
    volume_kg: float
    days: list[StatsDay]
    weeks: list[StatsWeek]
    weekdays: list[int]
    top_exercises: list[NameCount]
    muscles: list[StatsMuscle]
    progression: list[Progression]


# ── import / export files (the old app's formats) ────────────────────────────


class FileMember(BaseModel):
    type: Literal["exercise"] = "exercise"
    exercise_name: str = Field(min_length=1, max_length=100)
    sets: list[SetIn] = Field(default=[], max_length=100)


class FileExercise(FileMember):
    type: Literal["exercise"]


class FileCircuit(CircuitFields):
    type: Literal["circuit"]
    exercises: list[FileMember] = Field(max_length=50)


class _LegacyStrength(FileMember):
    """Pre-circuits export entry, still read so old files import."""

    type: Literal["strength"]


class _LegacyCardio(FileMember):
    """Pre-circuits cardio entry; the oldest ones had flat fields, not sets."""

    type: Literal["cardio"]
    intervals: int | None = Field(default=None, exclude=True)
    duration_s: int | None = Field(default=None, exclude=True)
    distance_m: float | None = Field(default=None, exclude=True)

    @model_validator(mode="after")
    def _sets_from_flat_fields(self):
        if not self.sets:
            count = min(max(self.intervals or 1, 1), 100)
            self.sets = [
                SetIn(duration_s=self.duration_s, distance_m=self.distance_m)
                for _ in range(count)
            ]
        return self


FileEntry = Annotated[
    FileExercise | FileCircuit | _LegacyStrength | _LegacyCardio,
    Field(discriminator="type"),
]


class WorkoutFile(BaseModel):
    date: dt.date
    duration_minutes: int = Field(ge=1, le=1440)
    exercises: list[FileEntry] = Field(max_length=100)


class TemplateFile(BaseModel):
    name: Name
    exercises: list[FileEntry] = Field(max_length=100)


class SavedCircuitFile(CircuitFields):
    name: Name
    exercises: list[FileMember] = Field(max_length=50)


class UserWorkoutsFile(BaseModel):
    user_email: str
    workouts: list[WorkoutFile]


class UserTemplatesFile(BaseModel):
    user_email: str
    templates: list[TemplateFile]


class _FileMuscle(BaseModel):
    name: str
    intensity: int


class ExerciseFile(BaseModel):
    """An `exercises.json` row. Loosely typed here: each row is checked as an
    `ExerciseIn` on import, so one bad row is skipped, not the whole file."""

    name: str
    type: str
    muscles: list[_FileMuscle] = []
    equipments: list[str] = []


class ImportResult(BaseModel):
    created: int = 0
    updated: int = 0
    skipped: int = 0
    # One line per skipped item, with the reason.
    ignored: list[str] = []
