import json
from datetime import datetime

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from apps.workout.models import (
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


class Command(BaseCommand):
    help = "Export all workout data to a JSON file"

    def add_arguments(self, parser):
        parser.add_argument(
            "--output",
            type=str,
            default="workout_data.json",
            help="Output file path (default: workout_data.json)",
        )
        parser.add_argument(
            "--user",
            type=str,
            default=None,
            help="Username to filter export by (exports all if omitted)",
        )

    def handle(self, *args, **kwargs):
        today_date = datetime.today().strftime("%Y-%m-%d")

        output_path: str = kwargs.get("output", "workout_data.json")
        username: str | None = kwargs.get("user")

        user = None
        if username:
            User = get_user_model()
            try:
                user = User.objects.get(username=username)
            except User.DoesNotExist:
                self.stdout.write(self.style.ERROR(f"User '{username}' not found"))
                return

        data = {
            "export_date": today_date,
            "type_workouts": self.export_type_workouts(),
            "muscle_groups": self.export_muscle_groups(),
            "equipment": self.export_equipment(),
            "exercises": self.export_exercises(),
            "workouts": self.export_workouts(user),
            "strength_series_logs": self.export_strength_series_logs(user),
            "cardio_series_logs": self.export_cardio_series_logs(user),
            "one_exercices": self.export_one_exercices(user),
            "workout_templates": self.export_workout_templates(user),
            "template_exercises": self.export_template_exercises(user),
            "template_strength_series": self.export_template_strength_series(user),
            "template_cardio_series": self.export_template_cardio_series(user),
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        self.stdout.write(
            self.style.SUCCESS(
                f"All workout data exported successfully to {output_path}"
            )
        )

    def export_type_workouts(self):
        return [
            {
                "id": tw.id,
                "name_workout": tw.name_workout,
            }
            for tw in TypeWorkout.objects.all()
        ]

    def export_muscle_groups(self):
        return [
            {
                "id": mg.id,
                "name": mg.name,
                "description": mg.description,
            }
            for mg in MuscleGroup.objects.all()
        ]

    def export_equipment(self):
        return [
            {
                "id": eq.id,
                "name": eq.name,
                "description": eq.description,
            }
            for eq in Equipment.objects.all()
        ]

    def export_exercises(self):
        return [
            {
                "id": ex.id,
                "name": ex.name,
                "exercise_type": ex.exercise_type,
                "difficulty": ex.difficulty,
                "muscle_groups": [mg.id for mg in ex.muscle_groups.all()],
                "equipment": [eq.id for eq in ex.equipment.all()],
            }
            for ex in Exercice.objects.all()
        ]

    def export_workouts(self, user=None):
        qs = Workout.objects.filter(user=user) if user else Workout.objects.all()
        return [
            {
                "id": w.id,
                "date": w.date.strftime("%Y-%m-%d"),
                "type_workout_id": w.type_workout.id if w.type_workout else None,
                "type_workout_name": (
                    w.type_workout.name_workout if w.type_workout else None
                ),
                "duration": w.duration,
            }
            for w in qs
        ]

    def export_strength_series_logs(self, user=None):
        qs = (
            StrengthSeriesLog.objects.filter(workout__user=user)
            if user
            else StrengthSeriesLog.objects.all()
        )
        return [
            {
                "id": ssl.id,
                "exercise_id": ssl.exercise.id,
                "exercise_name": ssl.exercise.name,
                "workout_id": ssl.workout.id,
                "series_number": ssl.series_number,
                "reps": ssl.reps,
                "weight": ssl.weight,
            }
            for ssl in qs
        ]

    def export_cardio_series_logs(self, user=None):
        qs = (
            CardioSeriesLog.objects.filter(workout__user=user)
            if user
            else CardioSeriesLog.objects.all()
        )
        return [
            {
                "id": csl.id,
                "exercise_id": csl.exercise.id,
                "exercise_name": csl.exercise.name,
                "workout_id": csl.workout.id,
                "series_number": csl.series_number,
                "duration_seconds": csl.duration_seconds,
                "distance_m": csl.distance_m,
            }
            for csl in qs
        ]

    def export_one_exercices(self, user=None):
        qs = (
            OneExercice.objects.filter(seance__user=user)
            if user
            else OneExercice.objects.all()
        )
        return [
            {
                "id": oe.id,
                "exercise_id": oe.name.id,
                "workout_id": oe.seance.id,
                "position": oe.position,
            }
            for oe in qs.select_related("name", "seance")
        ]

    def export_workout_templates(self, user=None):
        qs = (
            WorkoutTemplate.objects.filter(user=user)
            if user
            else WorkoutTemplate.objects.all()
        )
        return [
            {
                "id": wt.id,
                "name": wt.name,
                "type_workout_id": wt.type_workout.id if wt.type_workout else None,
                "duration": wt.duration,
                "is_active": wt.is_active,
            }
            for wt in qs
        ]

    def export_template_exercises(self, user=None):
        qs = (
            TemplateExercise.objects.filter(template__user=user)
            if user
            else TemplateExercise.objects.all()
        )
        return [
            {
                "id": te.id,
                "template_id": te.template.id,
                "exercise_id": te.exercise.id,
                "position": te.position,
            }
            for te in qs.select_related("template", "exercise")
        ]

    def export_template_strength_series(self, user=None):
        qs = (
            TemplateStrengthSeries.objects.filter(
                template_exercise__template__user=user
            )
            if user
            else TemplateStrengthSeries.objects.all()
        )
        return [
            {
                "id": tss.id,
                "template_exercise_id": tss.template_exercise.id,
                "series_number": tss.series_number,
                "reps": tss.reps,
                "weight": tss.weight,
            }
            for tss in qs
        ]

    def export_template_cardio_series(self, user=None):
        qs = (
            TemplateCardioSeries.objects.filter(template_exercise__template__user=user)
            if user
            else TemplateCardioSeries.objects.all()
        )
        return [
            {
                "id": tcs.id,
                "template_exercise_id": tcs.template_exercise.id,
                "series_number": tcs.series_number,
                "duration_seconds": tcs.duration_seconds,
                "distance_m": tcs.distance_m,
            }
            for tcs in qs
        ]
