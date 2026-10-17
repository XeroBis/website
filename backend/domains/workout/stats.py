"""Dashboard aggregates over a user's completed workouts (see features.md
"Stats"). Computed in Python: a user has hundreds of workouts, not millions."""

from collections import Counter, defaultdict
from datetime import date, timedelta

from domains.workout import models as m
from domains.workout import schemas as s


def is_weighted(set_) -> bool:
    return bool(set_.reps) and set_.weight_kg is not None and set_.weight_kg > 0


def set_volume(set_) -> float:
    """reps × weight, for sets with both and a positive weight."""
    return set_.reps * set_.weight_kg if is_weighted(set_) else 0.0


def est_1rm(weight_kg: float, reps: int) -> float:
    """Epley's estimated one-rep max."""
    return weight_kg * (1 + reps / 30)


def monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def compute(
    workouts: list[m.Workout], date_from: date | None, date_to: date | None
) -> s.Stats:
    dates = [w.date for w in workouts]
    start = date_from or (min(dates) if dates else None)
    end = date_to or (max(dates) if dates else None)

    volume = 0.0
    exercise_count = 0
    days: dict[date, list[int]] = defaultdict(list)
    week_workouts: Counter[date] = Counter()
    week_volume: defaultdict[date, float] = defaultdict(float)
    weekdays = [0] * 7
    times_done: Counter[str] = Counter()
    muscle_totals: Counter[str] = Counter()
    muscle_exercises: defaultdict[str, Counter[str]] = defaultdict(Counter)
    # exercise id -> date -> (max weight, max estimated 1RM)
    best: defaultdict[int, dict[date, tuple[float, float]]] = defaultdict(dict)
    names: dict[int, str] = {}

    for workout in workouts:
        week = monday(workout.date)
        days[workout.date].append(workout.id)
        week_workouts[week] += 1
        weekdays[workout.date.weekday()] += 1
        for row in workout.exercises:
            exercise = row.exercise
            exercise_count += 1
            times_done[exercise.name] += 1
            for muscle in exercise.muscles:
                muscle_totals[muscle.muscle] += muscle.intensity
                muscle_exercises[muscle.muscle][exercise.name] += 1
            weighted = [set_ for set_ in row.sets if is_weighted(set_)]
            row_volume = sum(set_volume(set_) for set_ in weighted)
            volume += row_volume
            week_volume[week] += row_volume
            if weighted:
                names[exercise.id] = exercise.name
                top = max(set_.weight_kg for set_ in weighted)
                top_1rm = max(est_1rm(st.weight_kg, st.reps) for st in weighted)
                previous = best[exercise.id].get(workout.date, (0.0, 0.0))
                best[exercise.id][workout.date] = (
                    max(previous[0], top),
                    max(previous[1], top_1rm),
                )

    weeks = []
    if start is not None and end is not None:
        week = monday(start)
        while week <= end:
            weeks.append(
                s.StatsWeek(
                    week_start=week,
                    workouts=week_workouts[week],
                    volume_kg=round(week_volume[week], 1),
                )
            )
            week += timedelta(days=7)

    return s.Stats(
        date_from=start,
        date_to=end,
        workouts=len(workouts),
        exercises=exercise_count,
        volume_kg=round(volume, 1),
        days=[
            s.StatsDay(date=day, workout_ids=sorted(ids))
            for day, ids in sorted(days.items())
        ],
        weeks=weeks,
        weekdays=weekdays,
        top_exercises=_by_count(times_done),
        muscles=[
            s.StatsMuscle(
                name=name, total=total, exercises=_by_count(muscle_exercises[name])
            )
            for name, total in sorted(muscle_totals.items())
        ],
        progression=[
            s.Progression(
                exercise_id=exercise_id,
                name=names[exercise_id],
                points=[
                    s.ProgressPoint(
                        date=day, max_weight_kg=weight, est_1rm_kg=round(one_rm, 1)
                    )
                    for day, (weight, one_rm) in sorted(points.items())
                ],
            )
            for exercise_id, points in sorted(
                best.items(), key=lambda item: names[item[0]].lower()
            )
        ],
    )


def _by_count(counter: Counter[str]) -> list[s.NameCount]:
    """Most done first, then by name."""
    return [
        s.NameCount(name=name, count=count)
        for name, count in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))
    ]
