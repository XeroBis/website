import json
import logging
import os
import tempfile
from datetime import datetime, timedelta
from typing import Any

from django.contrib.auth.decorators import login_required
from django.core.management import call_command
from django.core.paginator import Paginator
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.shortcuts import redirect, render
from django.utils import translation
from django.utils.formats import date_format
from django.utils.translation import gettext

from .models import (
    CardioSeriesLog,
    Equipment,
    Exercice,
    MuscleGroup,
    OneExercice,
    StrengthSeriesLog,
    TemplateCardioSeries,
    TemplateExercise,
    TemplateStrengthSeries,
    TypeWorkout,
    Workout,
    WorkoutTemplate,
)

logger = logging.getLogger(__name__)


def redirect_workout(request):
    lang = translation.get_language()

    # Get filter parameters
    workout_type_filter = request.GET.get("workout_type", "")
    exercise_filter = request.GET.get("exercise", "")

    # Base queryset
    workouts = Workout.objects.all().order_by("-date")

    # Apply workout type filter (exact match)
    if workout_type_filter:
        workouts = workouts.filter(
            type_workout__name_workout__exact=workout_type_filter
        )

    # Apply exercise filter (filter workouts that contain the specified exercise)
    if exercise_filter:
        workouts = workouts.filter(
            oneexercice__name__name__icontains=exercise_filter
        ).distinct()

    paginator = Paginator(workouts, 5)
    page_number = request.GET.get("page")
    page_obj = paginator.get_page(page_number)

    workout_data = []
    for workout in page_obj:
        type_workout = (
            workout.type_workout.name_workout if workout.type_workout else "No Type"
        )
        exercises: list[dict[str, Any]] = []

        # Get exercises ordered by position from OneExercice
        one_exercices = OneExercice.objects.filter(seance=workout).order_by("position")
        exercise_positions: dict[int, int] = {
            oe.name.id: oe.position for oe in one_exercices
        }

        # Get strength exercises with series
        strength_series = StrengthSeriesLog.objects.filter(workout=workout).order_by(
            "exercise", "series_number"
        )
        current_exercise: int | None = None
        current_exercise_data: dict[str, Any] | None = None

        for series in strength_series:
            if current_exercise != series.exercise.id:
                if current_exercise_data:
                    exercises.append(current_exercise_data)
                current_exercise = series.exercise.id
                current_exercise_data = {
                    "id": series.exercise.id,
                    "name": series.exercise.name,
                    "exercise_type": "strength",
                    "position": exercise_positions.get(series.exercise.id, 0),
                    "series": [],
                    "muscle_groups": list(
                        series.exercise.muscle_groups.all().values_list(
                            "name", flat=True
                        )
                    ),
                }

            if current_exercise_data is not None:
                current_exercise_data["series"].append(
                    {
                        "series_number": series.series_number,
                        "reps": series.reps,
                        "weight": series.weight,
                    }
                )

        if current_exercise_data:
            exercises.append(current_exercise_data)

        # Get cardio exercises with series
        cardio_series = CardioSeriesLog.objects.filter(workout=workout).order_by(
            "exercise", "series_number"
        )
        current_cardio_exercise: int | None = None
        current_cardio_data: dict[str, Any] | None = None

        for cardio_series_item in cardio_series:
            if current_cardio_exercise != cardio_series_item.exercise.id:
                if current_cardio_data:
                    exercises.append(current_cardio_data)
                current_cardio_exercise = cardio_series_item.exercise.id
                current_cardio_data = {
                    "id": cardio_series_item.exercise.id,
                    "name": cardio_series_item.exercise.name,
                    "exercise_type": "cardio",
                    "position": exercise_positions.get(
                        cardio_series_item.exercise.id, 0
                    ),
                    "series": [],
                    "muscle_groups": list(
                        cardio_series_item.exercise.muscle_groups.all().values_list(
                            "name", flat=True
                        )
                    ),
                }

            if current_cardio_data is not None:
                current_cardio_data["series"].append(
                    {
                        "series_number": cardio_series_item.series_number,
                        "duration_seconds": cardio_series_item.duration_seconds,
                        "distance_m": cardio_series_item.distance_m,
                    }
                )

        if current_cardio_data:
            exercises.append(current_cardio_data)

        # Sort exercises by position
        exercises.sort(key=lambda x: x.get("position", 0))

        # Compute muscle usage counts (series count per muscle group)
        muscle_counts: dict[str, int] = {}
        for exercise in exercises:
            series_count = len(exercise["series"])
            for mg in exercise["muscle_groups"]:
                muscle_counts[mg] = muscle_counts.get(mg, 0) + series_count

        # Compute summary stats
        strength_exercises = [e for e in exercises if e["exercise_type"] == "strength"]
        cardio_exercises = [e for e in exercises if e["exercise_type"] == "cardio"]
        strength_sets = sum(len(e["series"]) for e in strength_exercises)
        strength_volume = sum(
            (s["reps"] or 0) * (s["weight"] or 0)
            for e in strength_exercises
            for s in e["series"]
        )
        cardio_duration_s = sum(
            s.get("duration_seconds") or 0
            for e in cardio_exercises
            for s in e["series"]
        )
        cardio_distance_m = sum(
            s.get("distance_m") or 0 for e in cardio_exercises for s in e["series"]
        )
        stats = {
            "exercise_count": len(exercises),
            "has_strength": bool(strength_exercises),
            "has_cardio": bool(cardio_exercises),
            "strength_exercise_count": len(strength_exercises),
            "cardio_exercise_count": len(cardio_exercises),
            "strength_sets": strength_sets,
            "strength_volume": round(float(strength_volume), 1),
            "cardio_duration_min": (
                round(cardio_duration_s / 60, 1) if cardio_duration_s else 0
            ),
            "cardio_distance_km": (
                round(float(cardio_distance_m) / 1000, 2) if cardio_distance_m else 0
            ),
        }

        workout_data.append(
            {
                "workout": {
                    "id": workout.id,
                    "date": workout.date.strftime("%-d/%m/%Y"),
                    "month_year": workout.date.strftime("%Y-%m"),
                    "month_year_label": date_format(workout.date, "F Y"),
                    "type_workout": type_workout,
                    "duration": workout.duration,
                    "muscle_counts_json": json.dumps(muscle_counts),
                    "stats": stats,
                },
                "exercises": exercises,
            }
        )

    is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"

    # Get unique workout types and exercises for filter dropdowns
    all_workout_types = (
        TypeWorkout.objects.all()
        .values_list("name_workout", flat=True)
        .distinct()
        .order_by("name_workout")
    )
    all_exercises = (
        Exercice.objects.all()
        .values_list("name", flat=True)
        .distinct()
        .order_by("name")
    )

    if is_ajax:
        data = {
            "workout_data": workout_data,
            "has_next": page_obj.has_next(),
            "next_page_number": (
                page_obj.next_page_number() if page_obj.has_next() else None
            ),
        }
        return JsonResponse(data)

    context = {
        "page": "workout",
        "lang": lang,
        "workout_data": workout_data,
        "has_next": page_obj.has_next(),
        "next_page_number": (
            page_obj.next_page_number() if page_obj.has_next() else None
        ),
        "workout_type_filter": workout_type_filter,
        "exercise_filter": exercise_filter,
        "all_workout_types": all_workout_types,
        "all_exercises": all_exercises,
        "translations": {
            "exercise": gettext("Exercise"),
            "exercice": gettext("Exercise"),
            "series": gettext("Series"),
            "reps": gettext("Reps"),
            "weight_kg": gettext("Weight (kg)"),
            "duration_min": gettext("Duration (min)"),
            "distance_m": gettext("Distance (m)"),
            "edit": gettext("Edit"),
            "more_exercises": gettext("more exercises"),
        },
    }
    return render(request, "workout.html", context)


@login_required
def add_workout(request):
    lang = translation.get_language()

    if request.method == "POST":
        try:
            with transaction.atomic():
                date = request.POST["date"]
                type_workout = request.POST["type_workout"]
                duration = request.POST["duration"]

                type_obj, _ = TypeWorkout.objects.get_or_create(
                    name_workout=type_workout
                )

                workout = Workout.objects.create(
                    date=date, type_workout=type_obj, duration=duration
                )

                # Process exercises and series from form data
                # Form structure: exercise_<id>_name, exercise_<id>_series_<series_num>_reps, etc.
                exercise_data = {}
                for key, value in request.POST.items():
                    if key.startswith("exercise_") and key.endswith("_name"):
                        # Extract exercise ID: exercise_0_name -> 0
                        exercise_id = key.split("_")[1]
                        if exercise_id not in exercise_data:
                            exercise_data[exercise_id] = {"name": value, "series": {}}
                    elif key.startswith("exercise_") and "_series_" in key:
                        # Extract exercise ID and series number
                        # Format: exercise_<id>_series_<num>_<field>
                        parts = key.split("_")
                        exercise_id = parts[1]
                        series_num = parts[3]
                        field_name = "_".join(parts[4:])

                        if exercise_id not in exercise_data:
                            exercise_data[exercise_id] = {"name": "", "series": {}}
                        if series_num not in exercise_data[exercise_id]["series"]:
                            exercise_data[exercise_id]["series"][series_num] = {}

                        exercise_data[exercise_id]["series"][series_num][
                            field_name
                        ] = value

                logger.info(
                    f"Processing {len(exercise_data)} exercises "
                    f"for workout {workout.id}"
                )

                # Sort exercises by their ID to maintain order
                sorted_exercises = sorted(
                    exercise_data.items(), key=lambda x: int(x[0])
                )

                for position, (exercise_id, data) in enumerate(
                    sorted_exercises, start=1
                ):
                    logger.info(
                        f"Processing exercise_id: {exercise_id}, "
                        f"data: {data}, position: {position}"
                    )

                    if "name" not in data or not data["name"]:
                        logger.warning(f"Exercise {exercise_id} missing name, skipping")
                        continue

                    try:
                        exercise_obj = Exercice.objects.get(name=data["name"])
                        logger.info(
                            f"Found exercise: {exercise_obj.name} "
                            f"(type: {exercise_obj.exercise_type})"
                        )
                    except Exercice.DoesNotExist:
                        logger.warning(
                            f"Exercise '{data['name']}' not found in database, "
                            f"skipping"
                        )
                        continue

                    # Create OneExercice record for position tracking
                    _ = OneExercice.objects.create(
                        name=exercise_obj, seance=workout, position=position
                    )
                    logger.info(
                        f"Created OneExercice: {exercise_obj.name} "
                        f"at position {position}"
                    )

                    # Process series for this exercise
                    if exercise_obj.exercise_type == "strength":
                        logger.info(
                            f"Creating StrengthSeriesLog entries for "
                            f"exercise: {exercise_obj.name}, workout: {workout.id}"
                        )

                        for series_num_str, series_data in data["series"].items():
                            series_num = int(series_num_str)
                            reps = series_data.get("reps", 1)
                            if reps == "" or reps is None:
                                reps = 1
                            else:
                                reps = int(reps)

                            weight = series_data.get("weight", 0)
                            if weight == "" or weight is None:
                                weight = 0
                            else:
                                weight = int(weight)

                            StrengthSeriesLog.objects.create(
                                exercise=exercise_obj,
                                workout=workout,
                                series_number=series_num,
                                reps=reps,
                                weight=weight,
                            )
                            logger.info(
                                f"Created StrengthSeriesLog: "
                                f"{exercise_obj.name} series {series_num}"
                            )

                    elif exercise_obj.exercise_type == "cardio":
                        logger.info(
                            f"Creating CardioSeriesLog entries for "
                            f"exercise: {exercise_obj.name}, workout: {workout.id}"
                        )

                        for series_num_str, series_data in data["series"].items():
                            series_num = int(series_num_str)
                            duration = series_data.get("duration_seconds")
                            if duration == "" or duration is None:
                                duration = None
                            else:
                                duration = int(duration)

                            distance = series_data.get("distance_m")
                            if distance == "" or distance is None:
                                distance = None
                            else:
                                distance = float(distance)

                            CardioSeriesLog.objects.create(
                                exercise=exercise_obj,
                                workout=workout,
                                series_number=series_num,
                                duration_seconds=duration,
                                distance_m=distance,
                            )
                            logger.info(
                                f"Created CardioSeriesLog: "
                                f"{exercise_obj.name} interval {series_num}"
                            )

        except Exception as e:
            # If there's any error, redirect back to form with error handling
            logger.error(f"Error creating workout: {str(e)}", exc_info=True)
            return redirect("/workout/add_workout/")

        return redirect("/workout/")

    context = {
        "page": "add_workout",
        "lang": lang,
        "translations": {
            "sets": gettext("Sets"),
            "series": gettext("Series"),
            "reps": gettext("Reps"),
            "repetitions": gettext("Repetitions"),
            "weight_kg": gettext("Weight (kg)"),
            "duration_sec": gettext("Duration (sec)"),
            "distance_m": gettext("Distance (m)"),
            "no_template": gettext("No template"),
        },
    }
    return render(request, "add_workout.html", context)


@login_required
def get_last_workout(request):
    workout_type = request.GET.get("type")
    workout_type_id = TypeWorkout.objects.filter(name_workout=workout_type).first()
    last_workout = (
        Workout.objects.filter(type_workout=workout_type_id).order_by("-date").first()
    )

    all_exercises = (
        Exercice.objects.all().order_by("name").values("name", "exercise_type")
    )

    if last_workout:
        exercises_data: list[dict[str, Any]] = []

        # Get exercises ordered by position from OneExercice
        one_exercices = OneExercice.objects.filter(seance=last_workout).order_by(
            "position"
        )
        exercise_positions: dict[int, int] = {
            oe.name.id: oe.position for oe in one_exercices
        }

        # Get all strength exercises from the last workout
        strength_series = StrengthSeriesLog.objects.filter(
            workout=last_workout
        ).order_by("exercise", "series_number")
        current_exercise: int | None = None
        current_exercise_data: dict[str, Any] | None = None

        for series in strength_series:
            if current_exercise != series.exercise.id:
                if current_exercise_data:
                    exercises_data.append(current_exercise_data)
                current_exercise = series.exercise.id
                current_exercise_data = {
                    "name": series.exercise.name,
                    "exercise_type": "strength",
                    "position": exercise_positions.get(series.exercise.id, 0),
                    "series": [],
                }

            if current_exercise_data is not None:
                current_exercise_data["series"].append(
                    {
                        "series_number": series.series_number,
                        "reps": series.reps,
                        "weight": series.weight,
                    }
                )

        if current_exercise_data:
            exercises_data.append(current_exercise_data)

        # Get all cardio exercises from the last workout
        cardio_series = CardioSeriesLog.objects.filter(workout=last_workout).order_by(
            "exercise", "series_number"
        )
        current_cardio_exercise: int | None = None
        current_cardio_data: dict[str, Any] | None = None

        for cardio_series_item in cardio_series:
            if current_cardio_exercise != cardio_series_item.exercise.id:
                if current_cardio_data:
                    exercises_data.append(current_cardio_data)
                current_cardio_exercise = cardio_series_item.exercise.id
                current_cardio_data = {
                    "name": cardio_series_item.exercise.name,
                    "exercise_type": "cardio",
                    "position": exercise_positions.get(
                        cardio_series_item.exercise.id, 0
                    ),
                    "series": [],
                }

            if current_cardio_data is not None:
                current_cardio_data["series"].append(
                    {
                        "series_number": cardio_series_item.series_number,
                        "duration_seconds": cardio_series_item.duration_seconds,
                        "distance_m": cardio_series_item.distance_m,
                    }
                )

        if current_cardio_data:
            exercises_data.append(current_cardio_data)

        # Sort exercises by position
        exercises_data.sort(key=lambda x: x.get("position", 0))

        data = {
            "date": last_workout.date.strftime("%Y-%m-%d"),
            "exercises": exercises_data,
            "all_exercises": list(all_exercises),
        }
    else:
        data = {"all_exercises": list(all_exercises)}

    return JsonResponse(data)


@login_required
def get_list_exercise(_request):
    all_exercises = (
        Exercice.objects.all().order_by("name").values("name", "exercise_type")
    )
    data = {"all_exercises": list(all_exercises)}
    return JsonResponse(data)


@login_required
def get_workout_types(_request):
    workout_types = TypeWorkout.objects.all().order_by("name_workout")

    workout_types_data = []
    for workout_type in workout_types:
        workout_types_data.append(
            {"value": workout_type.name_workout, "display": workout_type.name_workout}
        )

    data = {"workout_types": workout_types_data}
    return JsonResponse(data)


@login_required
def edit_workout(request, workout_id):
    lang = translation.get_language()

    try:
        workout = Workout.objects.get(id=workout_id)
    except Workout.DoesNotExist:
        return redirect("/workout/")

    if request.method == "POST":
        try:
            with transaction.atomic():
                # Update workout basic fields
                workout.date = request.POST["date"]
                type_workout = request.POST["type_workout"]
                workout.duration = request.POST["duration"]

                type_obj, _ = TypeWorkout.objects.get_or_create(
                    name_workout=type_workout
                )
                workout.type_workout = type_obj
                workout.save()

                # Delete existing exercise data
                OneExercice.objects.filter(seance=workout).delete()
                StrengthSeriesLog.objects.filter(workout=workout).delete()
                CardioSeriesLog.objects.filter(workout=workout).delete()

                # Process exercises and series from form data
                # (same logic as add_workout)
                exercise_data = {}
                for key, value in request.POST.items():
                    if key.startswith("exercise_") and key.endswith("_name"):
                        exercise_id = key.split("_")[1]
                        if exercise_id not in exercise_data:
                            exercise_data[exercise_id] = {"name": value, "series": {}}
                    elif key.startswith("exercise_") and "_series_" in key:
                        parts = key.split("_")
                        exercise_id = parts[1]
                        series_num = parts[3]
                        field_name = "_".join(parts[4:])

                        if exercise_id not in exercise_data:
                            exercise_data[exercise_id] = {"name": "", "series": {}}
                        if series_num not in exercise_data[exercise_id]["series"]:
                            exercise_data[exercise_id]["series"][series_num] = {}

                        exercise_data[exercise_id]["series"][series_num][
                            field_name
                        ] = value

                # Sort exercises by their ID to maintain order
                sorted_exercises = sorted(
                    exercise_data.items(), key=lambda x: int(x[0])
                )

                for position, (_exercise_id, data) in enumerate(
                    sorted_exercises, start=1
                ):
                    if "name" not in data or not data["name"]:
                        continue

                    try:
                        exercise_obj = Exercice.objects.get(name=data["name"])
                    except Exercice.DoesNotExist:
                        continue

                    # Create OneExercice record for position tracking
                    _ = OneExercice.objects.create(
                        name=exercise_obj, seance=workout, position=position
                    )

                    # Process series for this exercise
                    if exercise_obj.exercise_type == "strength":
                        for series_num_str, series_data in data["series"].items():
                            series_num = int(series_num_str)
                            reps = series_data.get("reps", 1)
                            if reps == "" or reps is None:
                                reps = 1
                            else:
                                reps = int(reps)

                            weight = series_data.get("weight", 0)
                            if weight == "" or weight is None:
                                weight = 0
                            else:
                                weight = int(weight)

                            StrengthSeriesLog.objects.create(
                                exercise=exercise_obj,
                                workout=workout,
                                series_number=series_num,
                                reps=reps,
                                weight=weight,
                            )

                    elif exercise_obj.exercise_type == "cardio":
                        for series_num_str, series_data in data["series"].items():
                            series_num = int(series_num_str)
                            duration = series_data.get("duration_seconds")
                            if duration == "" or duration is None:
                                duration = None
                            else:
                                duration = int(duration)

                            distance = series_data.get("distance_m")
                            if distance == "" or distance is None:
                                distance = None
                            else:
                                distance = float(distance)

                            CardioSeriesLog.objects.create(
                                exercise=exercise_obj,
                                workout=workout,
                                series_number=series_num,
                                duration_seconds=duration,
                                distance_m=distance,
                            )

        except Exception as e:
            logger.error(f"Error updating workout: {str(e)}", exc_info=True)
            return redirect(f"/workout/edit_workout/{workout_id}/")

        return redirect("/workout/")

    # GET request - render edit form with existing data
    exercises_data: list[dict[str, Any]] = []

    # Get exercises ordered by position from OneExercice
    one_exercices = OneExercice.objects.filter(seance=workout).order_by("position")
    exercise_positions: dict[int, int] = {
        oe.name.id: oe.position for oe in one_exercices
    }

    # Get all strength exercises from the workout
    strength_series = StrengthSeriesLog.objects.filter(workout=workout).order_by(
        "exercise", "series_number"
    )
    current_exercise: int | None = None
    current_exercise_data: dict[str, Any] | None = None

    for series in strength_series:
        if current_exercise != series.exercise.id:
            if current_exercise_data:
                exercises_data.append(current_exercise_data)
            current_exercise = series.exercise.id
            current_exercise_data = {
                "name": series.exercise.name,
                "exercise_type": "strength",
                "position": exercise_positions.get(series.exercise.id, 0),
                "series": [],
            }

        if current_exercise_data is not None:
            current_exercise_data["series"].append(
                {
                    "series_number": series.series_number,
                    "reps": series.reps,
                    "weight": series.weight,
                }
            )

    if current_exercise_data:
        exercises_data.append(current_exercise_data)

    # Get all cardio exercises from the workout
    cardio_series = CardioSeriesLog.objects.filter(workout=workout).order_by(
        "exercise", "series_number"
    )
    current_cardio_exercise: int | None = None
    current_cardio_data: dict[str, Any] | None = None

    for cardio_series_item in cardio_series:
        if current_cardio_exercise != cardio_series_item.exercise.id:
            if current_cardio_data:
                exercises_data.append(current_cardio_data)
            current_cardio_exercise = cardio_series_item.exercise.id
            current_cardio_data = {
                "name": cardio_series_item.exercise.name,
                "exercise_type": "cardio",
                "position": exercise_positions.get(cardio_series_item.exercise.id, 0),
                "series": [],
            }

        if current_cardio_data is not None:
            current_cardio_data["series"].append(
                {
                    "series_number": cardio_series_item.series_number,
                    "duration_seconds": cardio_series_item.duration_seconds,
                    "distance_m": cardio_series_item.distance_m,
                }
            )

    if current_cardio_data:
        exercises_data.append(current_cardio_data)

    # Sort exercises by position
    exercises_data.sort(key=lambda x: x.get("position", 0))

    # Get all exercises for dropdown
    all_exercises = (
        Exercice.objects.all().order_by("name").values("name", "exercise_type")
    )

    context = {
        "page": "edit_workout",
        "lang": lang,
        "workout": {
            "id": workout.id,
            "date": workout.date.strftime("%Y-%m-%d"),
            "type_workout": (
                workout.type_workout.name_workout if workout.type_workout else ""
            ),
            "duration": workout.duration,
        },
        "exercises": exercises_data,
        "all_exercises": list(all_exercises),
        "translations": {
            "sets": gettext("Sets"),
            "series": gettext("Series"),
            "reps": gettext("Reps"),
            "repetitions": gettext("Repetitions"),
            "weight_kg": gettext("Weight (kg)"),
            "duration_sec": gettext("Duration (sec)"),
            "distance_m": gettext("Distance (m)"),
            "no_template": gettext("No template"),
        },
    }
    return render(request, "edit_workout.html", context)


@login_required
def create_template_from_workout(request, workout_id):
    if request.method != "POST":
        return JsonResponse(
            {"success": False, "error": "POST method required"}, status=405
        )

    try:
        data = json.loads(request.body)
        template_name = data.get("template_name", "").strip()

        if not template_name:
            return JsonResponse(
                {"success": False, "error": "Template name is required"}, status=400
            )

        # Load workout with related data
        workout = Workout.objects.get(id=workout_id)

        # Create template in atomic transaction
        with transaction.atomic():
            # Create WorkoutTemplate
            template = WorkoutTemplate.objects.create(
                name=template_name,
                type_workout=workout.type_workout,
                duration=workout.duration,
            )

            # Get exercises ordered by position
            one_exercises = OneExercice.objects.filter(seance=workout).order_by(
                "position"
            )

            for one_exercise in one_exercises:
                # Create TemplateExercise
                template_exercise = TemplateExercise.objects.create(
                    template=template,
                    exercise=one_exercise.name,
                    position=one_exercise.position,
                )

                # Get strength series for this exercise
                strength_series = StrengthSeriesLog.objects.filter(
                    workout=workout, exercise=one_exercise.name
                ).order_by("series_number")

                for strength_series_item in strength_series:
                    TemplateStrengthSeries.objects.create(
                        template_exercise=template_exercise,
                        series_number=strength_series_item.series_number,
                        reps=strength_series_item.reps,
                        weight=strength_series_item.weight,
                    )

                # Get cardio series for this exercise
                cardio_series = CardioSeriesLog.objects.filter(
                    workout=workout, exercise=one_exercise.name
                ).order_by("series_number")

                for cardio_series_item in cardio_series:
                    TemplateCardioSeries.objects.create(
                        template_exercise=template_exercise,
                        series_number=cardio_series_item.series_number,
                        duration_seconds=cardio_series_item.duration_seconds,
                        distance_m=cardio_series_item.distance_m,
                    )

        return JsonResponse(
            {
                "success": True,
                "template_id": template.id,
                "template_name": template.name,
            }
        )

    except Workout.DoesNotExist:
        return JsonResponse(
            {"success": False, "error": "Workout not found"}, status=404
        )
    except Exception as e:
        logger.error(f"Error creating template: {e}")
        return JsonResponse({"success": False, "error": str(e)}, status=500)


@login_required
def get_template_list(_request):
    templates = WorkoutTemplate.objects.filter(is_active=True).order_by("name")

    templates_data = []
    for template in templates:
        templates_data.append(
            {
                "id": template.id,
                "name": template.name,
                "type": (
                    template.type_workout.name_workout if template.type_workout else ""
                ),
                "duration": template.duration,
            }
        )

    return JsonResponse({"templates": templates_data})


@login_required
def get_template_details(request):
    template_id = request.GET.get("template_id")

    if not template_id:
        return JsonResponse({"error": "template_id is required"}, status=400)

    try:
        template = WorkoutTemplate.objects.get(id=template_id, is_active=True)

        # Get all exercises for dropdown
        all_exercises = (
            Exercice.objects.all().order_by("name").values("name", "exercise_type")
        )

        exercises_data: list[dict[str, Any]] = []

        # Get template exercises ordered by position
        template_exercises = TemplateExercise.objects.filter(
            template=template
        ).order_by("position")

        for template_exercise in template_exercises:
            # Get strength series for this template exercise
            strength_series = TemplateStrengthSeries.objects.filter(
                template_exercise=template_exercise
            ).order_by("series_number")

            if strength_series.exists():
                strength_series_list: list[dict[str, Any]] = []
                for strength_series_item in strength_series:
                    strength_series_list.append(
                        {
                            "series_number": strength_series_item.series_number,
                            "reps": strength_series_item.reps,
                            "weight": strength_series_item.weight,
                        }
                    )

                exercise_data = {
                    "name": template_exercise.exercise.name,
                    "exercise_type": "strength",
                    "position": template_exercise.position,
                    "series": strength_series_list,
                }

                exercises_data.append(exercise_data)

            # Get cardio series for this template exercise
            cardio_series = TemplateCardioSeries.objects.filter(
                template_exercise=template_exercise
            ).order_by("series_number")

            if cardio_series.exists():
                cardio_series_list: list[dict[str, Any]] = []
                for cardio_series_item in cardio_series:
                    cardio_series_list.append(
                        {
                            "series_number": cardio_series_item.series_number,
                            "duration_seconds": cardio_series_item.duration_seconds,
                            "distance_m": cardio_series_item.distance_m,
                        }
                    )

                exercise_data = {
                    "name": template_exercise.exercise.name,
                    "exercise_type": "cardio",
                    "position": template_exercise.position,
                    "series": cardio_series_list,
                }

                exercises_data.append(exercise_data)

        data = {
            "duration": template.duration,
            "type_workout": (
                template.type_workout.name_workout if template.type_workout else ""
            ),
            "exercises": exercises_data,
            "all_exercises": list(all_exercises),
        }

        return JsonResponse(data)

    except WorkoutTemplate.DoesNotExist:
        return JsonResponse({"error": "Template not found"}, status=404)
    except Exception as e:
        logger.error(f"Error getting template details: {e}")
        return JsonResponse({"error": str(e)}, status=500)


def exercise_library(request):
    lang = translation.get_language()

    # Get filter parameters
    name = request.GET.get("name", "")
    muscle_group_id = request.GET.get("muscle_group", "")
    difficulty = request.GET.get("difficulty", "")
    equipment_id = request.GET.get("equipment", "")

    # Start with all exercises
    exercises = (
        Exercice.objects.all()
        .prefetch_related("muscle_groups", "equipment")
        .order_by("name")
    )

    # Apply filters
    if name:
        exercises = exercises.filter(name__icontains=name)
    if muscle_group_id:
        exercises = exercises.filter(muscle_groups__id=muscle_group_id)
    if difficulty:
        exercises = exercises.filter(difficulty=difficulty)
    if equipment_id:
        exercises = exercises.filter(equipment__id=equipment_id)

    # Get all muscle groups and equipment for filter dropdowns
    muscle_groups = MuscleGroup.objects.all().order_by("name")
    difficulties = Exercice.DIFFICULTY_CHOICES
    equipments = Equipment.objects.all().order_by("name")

    # Check if it's an AJAX request
    is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"

    context = {
        "page": "exercise_library",
        "lang": lang,
        "exercises": exercises,
        "muscle_groups": muscle_groups,
        "difficulties": difficulties,
        "equipments": equipments,
        "selected_name": name,
        "selected_muscle_group": muscle_group_id,
        "selected_difficulty": difficulty,
        "selected_equipment": equipment_id,
        "translations": {
            "exercise_library": gettext("Exercise Library"),
            "filters": gettext("Filters"),
            "muscle_group": gettext("Muscle Group"),
            "difficulty": gettext("Difficulty"),
            "equipment": gettext("Equipment"),
            "all": gettext("All"),
            "no_exercises": gettext("No exercises found."),
        },
    }

    if is_ajax:
        # Return only the exercises grid HTML for AJAX requests
        from django.template.loader import render_to_string

        exercises_html = render_to_string(
            "workout/exercise_library_grid.html", context, request=request
        )
        return JsonResponse({"exercises_html": exercises_html})

    return render(request, "exercise_library.html", context)


@login_required
def export_data(_request):
    """Export all workout data to JSON file"""
    try:
        # Create temporary file
        with tempfile.NamedTemporaryFile(
            mode="w", delete=False, suffix=".json"
        ) as tmp_file:
            tmp_path = tmp_file.name

        # Call the export command
        call_command("export_workout_data", output=tmp_path)

        # Read the file and return as download
        with open(tmp_path, "r", encoding="utf-8") as f:
            response = HttpResponse(f.read(), content_type="application/json")
            today_date = datetime.today().strftime("%Y-%m-%d")
            response["Content-Disposition"] = (
                f'attachment; filename="workout_data_{today_date}.json"'
            )

        # Clean up temp file
        os.unlink(tmp_path)

        return response
    except Exception as e:
        logger.error(f"Error exporting data: {str(e)}", exc_info=True)
        return JsonResponse({"error": str(e)}, status=500)


@login_required
def import_data(request):
    """Import workout data from JSON file"""
    if request.method != "POST":
        return JsonResponse({"error": "POST request required"}, status=400)

    if "file" not in request.FILES:
        return JsonResponse({"error": "No file provided"}, status=400)

    try:
        uploaded_file = request.FILES["file"]

        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(
            mode="wb", delete=False, suffix=".json"
        ) as tmp_file:
            for chunk in uploaded_file.chunks():
                tmp_file.write(chunk)
            tmp_path = tmp_file.name

        # Call the import command
        call_command("import_workout_data", file=tmp_path)

        # Clean up temp file
        os.unlink(tmp_path)

        return JsonResponse({"success": True, "message": "Data imported successfully"})
    except Exception as e:
        logger.error(f"Error importing data: {str(e)}", exc_info=True)
        return JsonResponse({"error": str(e)}, status=500)


@login_required
def clear_data(request):
    """Clear all workout data"""
    if request.method != "POST":
        return JsonResponse({"error": "POST request required"}, status=400)

    try:
        # Call the clear command with no-input flag
        call_command("clear_workout_data", no_input=True)
        return JsonResponse(
            {"success": True, "message": "All data cleared successfully"}
        )
    except Exception as e:
        logger.error(f"Error clearing data: {str(e)}", exc_info=True)
        return JsonResponse({"error": str(e)}, status=500)


def get_dashboard_data(request):
    """Get dashboard statistics filtered by date range (AJAX endpoint)"""
    from django.db.models import Count, F, Sum

    # Get date filter parameters
    start_date = request.GET.get("start_date", "")
    end_date = request.GET.get("end_date", "")

    # Build filter
    workout_filter = {}
    if start_date:
        workout_filter["date__gte"] = start_date
    if end_date:
        workout_filter["date__lte"] = end_date

    # Build the filtered workout queryset
    filtered_workouts = (
        Workout.objects.filter(**workout_filter)
        if workout_filter
        else Workout.objects.all()
    )

    total_workouts = filtered_workouts.count()

    # Get exercise IDs from filtered workouts
    if workout_filter:
        filtered_workout_ids = filtered_workouts.values_list("id", flat=True)
        total_exercises = OneExercice.objects.filter(
            seance_id__in=filtered_workout_ids
        ).count()

        # Calculate total volume (for strength exercises) with date filter
        total_volume = (
            StrengthSeriesLog.objects.filter(
                workout_id__in=filtered_workout_ids
            ).aggregate(total=Sum(F("reps") * F("weight")))["total"]
            or 0
        )

        # Workouts by type with date filter
        workouts_by_type = list(
            filtered_workouts.values("type_workout__name_workout")
            .annotate(count=Count("id"))
            .order_by("-count")
        )

        # Top exercises by frequency with date filter
        top_exercises = list(
            OneExercice.objects.filter(seance_id__in=filtered_workout_ids)
            .values("name__name")
            .annotate(count=Count("id"))
            .order_by("-count")[:5]
        )
    else:
        total_exercises = OneExercice.objects.count()

        # Calculate total volume (for strength exercises)
        total_volume = (
            StrengthSeriesLog.objects.aggregate(total=Sum(F("reps") * F("weight")))[
                "total"
            ]
            or 0
        )

        # Workouts by type
        workouts_by_type = list(
            Workout.objects.values("type_workout__name_workout")
            .annotate(count=Count("id"))
            .order_by("-count")
        )

        # Top exercises by frequency
        top_exercises = list(
            OneExercice.objects.values("name__name")
            .annotate(count=Count("id"))
            .order_by("-count")[:5]
        )

    # Weekly workouts trend - use date filter for the range if provided
    if start_date and end_date:
        # Calculate weeks between start and end date
        from datetime import datetime as dt

        start_dt = dt.strptime(start_date, "%Y-%m-%d").date()
        end_dt = dt.strptime(end_date, "%Y-%m-%d").date()

        # Adjust start_dt to Monday of that week (Monday = 0, Sunday = 6)
        days_since_monday = start_dt.weekday()
        start_dt = start_dt - timedelta(days=days_since_monday)

        total_days = (end_dt - start_dt).days
        num_weeks = max(
            total_days // 7 + 1, 1
        )  # Show all weeks including partial current week

        weekly_workouts = []
        for week in range(num_weeks):
            week_start = start_dt + timedelta(weeks=week)
            week_end = min(week_start + timedelta(days=6), end_dt)
            count = Workout.objects.filter(
                date__gte=week_start, date__lte=week_end
            ).count()
            weekly_workouts.append(
                {
                    "week": week + 1,
                    "count": count,
                    "start": week_start.strftime("%d/%m/%Y"),
                }
            )
    else:
        # Show all available data - calculate from earliest workout to now
        earliest_workout = Workout.objects.order_by("date").first()
        if earliest_workout:
            start_dt = earliest_workout.date
            end_dt = datetime.now().date()

            # Adjust start_dt to Monday of that week (Monday = 0, Sunday = 6)
            days_since_monday = start_dt.weekday()
            start_dt = start_dt - timedelta(days=days_since_monday)

            total_days = (end_dt - start_dt).days
            num_weeks = max(total_days // 7 + 1, 1)

            weekly_workouts = []
            for week in range(num_weeks):
                week_start = start_dt + timedelta(weeks=week)
                week_end = min(week_start + timedelta(days=6), end_dt)
                count = Workout.objects.filter(
                    date__gte=week_start, date__lte=week_end
                ).count()
                weekly_workouts.append(
                    {
                        "week": week + 1,
                        "count": count,
                        "start": week_start.strftime("%d/%m/%Y"),
                    }
                )
        else:
            # No workouts yet
            weekly_workouts = []

    return JsonResponse(
        {
            "total_workouts": total_workouts,
            "total_exercises": total_exercises,
            "total_volume": int(total_volume),
            "workouts_by_type": workouts_by_type,
            "weekly_workouts": weekly_workouts,
            "top_exercises": top_exercises,
        }
    )


def calculate_personal_records():
    """
    Calculate personal records at runtime from StrengthSeriesLog data.

    Returns a list of personal records sorted by date achieved (most recent first).
    """
    # Get all strength series logs (only exercises with weight)
    logs = (
        StrengthSeriesLog.objects.select_related("exercise", "workout")
        .filter(weight__gt=0)  # Only include exercises with weight > 0
        .order_by("-workout__date")
    )

    # Track personal records for each exercise
    records_by_exercise: dict[int, dict[str, Any]] = {}
    all_records: list[dict[str, Any]] = []

    for log in logs:
        exercise_id = log.exercise.id

        if exercise_id not in records_by_exercise:
            records_by_exercise[exercise_id] = {
                "max_weight": None,
            }

        exercise_records = records_by_exercise[exercise_id]

        # Check for max weight record
        if (
            exercise_records["max_weight"] is None
            or log.weight > exercise_records["max_weight"]["value"]
        ):
            exercise_records["max_weight"] = {
                "exercise": log.exercise,
                "record_type": "max_weight",
                "value": log.weight,
                "date_achieved": log.workout.date,
                "workout": log.workout,
                "display_name": "Max Weight",
            }

    # Collect all records
    for _exercise_id, records in records_by_exercise.items():
        for _record_type, record_data in records.items():
            if record_data:
                all_records.append(record_data)

    # Sort by max weight (heaviest first)
    all_records.sort(key=lambda x: x["value"], reverse=True)
    return all_records


def get_calendar_data(request):
    """AJAX endpoint to get calendar data for a specific year"""
    import calendar as cal
    from collections import defaultdict

    from django.http import JsonResponse

    # Get year from URL parameter or use current year
    current_year = int(request.GET.get("year", datetime.now().year))
    current_month = datetime.now().month

    # Get all workouts for calendar view
    workouts = Workout.objects.filter(date__year=current_year).order_by("date")

    # Determine which years have workout data
    years_with_data = (
        Workout.objects.dates("date", "year")
        .values_list("date__year", flat=True)
        .distinct()
    )
    years_with_data_l = list(years_with_data)

    # Check if there's data for previous and next year
    has_prev_year_data = (current_year - 1) in years_with_data_l
    has_next_year_data = (current_year + 1) in years_with_data_l

    # Create calendar data structure
    calendar_data = defaultdict(list)
    for workout in workouts:
        month_key = f"{workout.date.year}-{workout.date.month:02d}"
        calendar_data[month_key].append(
            {
                "day": workout.date.day,
                "type": (
                    workout.type_workout.name_workout
                    if workout.type_workout
                    else "No Type"
                ),
                "duration": workout.duration,
                "id": workout.id,
            }
        )

    # Define translatable month names
    month_names = [
        gettext("January"),
        gettext("February"),
        gettext("March"),
        gettext("April"),
        gettext("May"),
        gettext("June"),
        gettext("July"),
        gettext("August"),
        gettext("September"),
        gettext("October"),
        gettext("November"),
        gettext("December"),
    ]

    months_data = []
    for month in range(1, 13):
        month_name = month_names[month - 1]
        month_key = f"{current_year}-{month:02d}"

        # Get first day of month and number of days
        first_day = datetime(current_year, month, 1)
        num_days = cal.monthrange(current_year, month)[1]
        start_weekday = first_day.weekday()

        # Get workouts for this month
        month_workouts = calendar_data.get(month_key, [])
        workout_days = {w["day"]: w for w in month_workouts}

        months_data.append(
            {
                "name": month_name,
                "number": month,
                "num_days": num_days,
                "start_weekday": start_weekday,
                "empty_days_before": list(range(start_weekday)),
                "workout_days": workout_days,
                "is_current": month == current_month
                and current_year == datetime.now().year,
            }
        )

    return JsonResponse(
        {
            "year": current_year,
            "months": months_data,
            "has_prev_year_data": has_prev_year_data,
            "has_next_year_data": has_next_year_data,
        }
    )


def analytics(request):
    """Analytics page with calendar view, progress dashboard, and PR tracking"""
    import calendar as cal
    import json
    from collections import defaultdict

    from django.db.models import Count, F, Sum

    lang = translation.get_language()

    # Use current year for initial page load
    current_year = datetime.now().year
    current_month = datetime.now().month

    # Get all workouts for calendar view
    workouts = Workout.objects.filter(date__year=current_year).order_by("date")

    # Determine which years have workout data
    years_with_data = (
        Workout.objects.dates("date", "year")
        .values_list("date__year", flat=True)
        .distinct()
    )
    years_with_data_l = list(years_with_data)

    # Check if there's data for previous and next year
    has_prev_year_data = (current_year - 1) in years_with_data_l
    has_next_year_data = (current_year + 1) in years_with_data_l

    # Create calendar data structure
    calendar_data = defaultdict(list)
    for workout in workouts:
        month_key = f"{workout.date.year}-{workout.date.month:02d}"
        calendar_data[month_key].append(
            {
                "day": workout.date.day,
                "type": (
                    workout.type_workout.name_workout
                    if workout.type_workout
                    else "No Type"
                ),
                "duration": workout.duration,
                "id": workout.id,
            }
        )

    # Dashboard statistics - start with all workouts for initial load
    total_exercises = OneExercice.objects.count()

    # Calculate total volume (for strength exercises)
    total_volume = (
        StrengthSeriesLog.objects.aggregate(total=Sum(F("reps") * F("weight")))["total"]
        or 0
    )

    # Workouts by type
    workouts_by_type = list(
        Workout.objects.values("type_workout__name_workout")
        .annotate(count=Count("id"))
        .order_by("-count")
    )

    # Top exercises by frequency
    top_exercises = list(
        OneExercice.objects.values("name__name")
        .annotate(count=Count("id"))
        .order_by("-count")[:5]
    )

    # Total workouts for initial load
    total_workouts = Workout.objects.count()

    # Weekly workouts trend - calculate from earliest workout to now
    earliest_workout = Workout.objects.order_by("date").first()
    if earliest_workout:
        start_dt = earliest_workout.date
        end_dt = datetime.now().date()
        total_days = (end_dt - start_dt).days
        num_weeks = max(total_days // 7, 1)

        weekly_workouts = []
        for week in range(num_weeks):
            week_start = start_dt + timedelta(weeks=week)
            week_end = min(week_start + timedelta(days=6), end_dt)
            count = Workout.objects.filter(
                date__gte=week_start, date__lte=week_end
            ).count()
            weekly_workouts.append(
                {
                    "week": week + 1,
                    "count": count,
                    "start": week_start.strftime("%d/%m/%Y"),
                }
            )
    else:
        # No workouts yet
        weekly_workouts = []

    # Personal Records (calculated at runtime)
    personal_records = calculate_personal_records()

    # Generate calendar months for the year
    # Define translatable month names
    month_names = [
        gettext("January"),
        gettext("February"),
        gettext("March"),
        gettext("April"),
        gettext("May"),
        gettext("June"),
        gettext("July"),
        gettext("August"),
        gettext("September"),
        gettext("October"),
        gettext("November"),
        gettext("December"),
    ]

    months_data = []
    for month in range(1, 13):
        month_name = month_names[month - 1]
        month_key = f"{current_year}-{month:02d}"

        # Get first day of month and number of days
        first_day = datetime(current_year, month, 1)
        num_days = cal.monthrange(current_year, month)[1]
        start_weekday = first_day.weekday()

        # Get workouts for this month
        month_workouts = calendar_data.get(month_key, [])
        workout_days = {w["day"]: w for w in month_workouts}

        months_data.append(
            {
                "name": month_name,
                "number": month,
                "num_days": num_days,
                "start_weekday": start_weekday,
                "empty_days_before": list(range(start_weekday)),
                "workout_days": workout_days,
                "is_current": month == current_month,
            }
        )

    context = {
        "page": "analytics",
        "lang": lang,
        "current_year": current_year,
        "months": months_data,
        "has_prev_year_data": has_prev_year_data,
        "has_next_year_data": has_next_year_data,
        "total_workouts": total_workouts,
        "total_exercises": total_exercises,
        "total_volume": int(total_volume),
        "workouts_by_type": json.dumps(workouts_by_type),
        "weekly_workouts": json.dumps(weekly_workouts),
        "personal_records": personal_records,
        "top_exercises": json.dumps(top_exercises),
        "translations": {
            "analytics": gettext("Analytics"),
            "calendar": gettext("Calendar"),
            "dashboard": gettext("Dashboard"),
            "personal_records": gettext("Personal Records"),
            "total_workouts": gettext("Total Workouts"),
            "total_exercises": gettext("Total Exercises"),
            "total_volume": gettext("Total Volume"),
            "current_streak": gettext("Current Streak"),
            "longest_streak": gettext("Longest Streak"),
            "workouts_by_type": gettext("Workouts by Type"),
            "weekly_trend": gettext("Weekly Trend"),
            "top_exercises": gettext("Top Exercises"),
        },
    }

    return render(request, "workout/analytics.html", context)
