import json
from datetime import datetime

from django.core.management.base import BaseCommand
from django.db import transaction

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
    help = "Import all workout data from a JSON file"

    def add_arguments(self, parser):
        parser.add_argument(
            "--file",
            type=str,
            required=True,
            help="Input JSON file path",
        )

    def handle(self, *args, **kwargs):
        input_path = kwargs["file"]

        try:
            with open(input_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            self.stdout.write(self.style.ERROR(f"File not found: {input_path}"))
            return
        except json.JSONDecodeError as e:
            self.stdout.write(self.style.ERROR(f"Invalid JSON file: {e}"))
            return

        self.stdout.write("Importing data...")

        # Convert legacy aggregated logs to series format when present.
        strength_series = data.get("strength_series_logs", [])
        cardio_series = data.get("cardio_series_logs", [])

        if data.get("strength_exercise_logs"):
            self.stdout.write(
                "  Detected legacy strength logs — converting to series format..."
            )
            strength_series = strength_series + self.convert_legacy_strength_logs(
                data["strength_exercise_logs"]
            )
        if data.get("cardio_exercise_logs"):
            self.stdout.write(
                "  Detected legacy cardio logs — converting to series format..."
            )
            cardio_series = cardio_series + self.convert_legacy_cardio_logs(
                data["cardio_exercise_logs"]
            )

        with transaction.atomic():
            # Build ID→object maps as we import each layer so subsequent
            # layers can resolve cross-references without relying on DB IDs.
            type_workout_map = self.import_type_workouts(data.get("type_workouts", []))
            muscle_group_map = self.import_muscle_groups(data.get("muscle_groups", []))
            equipment_map = self.import_equipment(data.get("equipment", []))
            exercise_map = self.import_exercises(
                data.get("exercises", []), muscle_group_map, equipment_map
            )
            workout_map = self.import_workouts(
                data.get("workouts", []), type_workout_map
            )
            self.import_strength_series_logs(strength_series, exercise_map, workout_map)
            self.import_cardio_series_logs(cardio_series, exercise_map, workout_map)
            self.import_one_exercices(
                data.get("one_exercices", []),
                exercise_map,
                workout_map,
            )
            template_map = self.import_workout_templates(
                data.get("workout_templates", []), type_workout_map
            )
            template_exercise_map = self.import_template_exercises(
                data.get("template_exercises", []), template_map, exercise_map
            )
            self.import_template_strength_series(
                data.get("template_strength_series", []), template_exercise_map
            )
            self.import_template_cardio_series(
                data.get("template_cardio_series", []), template_exercise_map
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"All workout data imported successfully from {input_path}"
            )
        )

    def import_type_workouts(self, type_workouts):
        """Return {json_id: TypeWorkout} map."""
        id_map = {}
        for tw_data in type_workouts:
            obj, _ = TypeWorkout.objects.get_or_create(
                name_workout=tw_data["name_workout"]
            )
            id_map[tw_data["id"]] = obj
        self.stdout.write(
            self.style.SUCCESS(f"  Imported {len(type_workouts)} type workouts")
        )
        return id_map

    def import_muscle_groups(self, muscle_groups):
        """Return {json_id: MuscleGroup} map."""
        id_map = {}
        for mg_data in muscle_groups:
            obj, _ = MuscleGroup.objects.update_or_create(
                name=mg_data["name"],
                defaults={"description": mg_data.get("description", "")},
            )
            id_map[mg_data["id"]] = obj
        self.stdout.write(
            self.style.SUCCESS(f"  Imported {len(muscle_groups)} muscle groups")
        )
        return id_map

    def import_equipment(self, equipment_list):
        """Return {json_id: Equipment} map."""
        id_map = {}
        for eq_data in equipment_list:
            obj, _ = Equipment.objects.update_or_create(
                name=eq_data["name"],
                defaults={"description": eq_data.get("description", "")},
            )
            id_map[eq_data["id"]] = obj
        self.stdout.write(
            self.style.SUCCESS(f"  Imported {len(equipment_list)} equipment")
        )
        return id_map

    def import_exercises(self, exercises, muscle_group_map, equipment_map):
        """Return {json_id: Exercice} map."""
        id_map = {}
        for ex_data in exercises:
            obj, _ = Exercice.objects.update_or_create(
                name=ex_data["name"],
                defaults={
                    "exercise_type": ex_data["exercise_type"],
                    "difficulty": ex_data.get("difficulty", ""),
                },
            )
            if "muscle_groups" in ex_data:
                mapped_mgs = [
                    muscle_group_map[mg_id]
                    for mg_id in ex_data["muscle_groups"]
                    if mg_id in muscle_group_map
                ]
                obj.muscle_groups.set(mapped_mgs)
            if "equipment" in ex_data:
                mapped_eqs = [
                    equipment_map[eq_id]
                    for eq_id in ex_data["equipment"]
                    if eq_id in equipment_map
                ]
                obj.equipment.set(mapped_eqs)
            id_map[ex_data["id"]] = obj
        self.stdout.write(self.style.SUCCESS(f"  Imported {len(exercises)} exercises"))
        return id_map

    def import_workouts(self, workouts, type_workout_map):
        """Return {json_id: Workout} map."""
        id_map = {}
        for w_data in workouts:
            type_workout = type_workout_map.get(w_data.get("type_workout_id"))
            date = datetime.strptime(w_data["date"], "%Y-%m-%d").date()
            obj, _ = Workout.objects.update_or_create(
                date=date,
                type_workout=type_workout,
                defaults={"duration": w_data.get("duration", 0)},
            )
            id_map[w_data["id"]] = obj
        self.stdout.write(self.style.SUCCESS(f"  Imported {len(workouts)} workouts"))
        return id_map

    def import_strength_series_logs(
        self, strength_series_logs, exercise_map, workout_map
    ):
        """Return {json_id: StrengthSeriesLog} map."""
        id_map = {}
        imported = 0
        for ssl_data in strength_series_logs:
            exercise = exercise_map.get(ssl_data["exercise_id"])
            workout = workout_map.get(ssl_data["workout_id"])
            if not exercise or not workout:
                self.stdout.write(
                    self.style.WARNING(
                        f"  Skipping strength series log "
                        f"(exercise_id={ssl_data['exercise_id']}, "
                        f"workout_id={ssl_data['workout_id']}): "
                        f"exercise or workout not found in map"
                    )
                )
                continue
            obj, _ = StrengthSeriesLog.objects.update_or_create(
                exercise=exercise,
                workout=workout,
                series_number=ssl_data["series_number"],
                defaults={
                    "reps": ssl_data.get("reps"),
                    "weight": ssl_data.get("weight"),
                },
            )
            if "id" in ssl_data:
                id_map[ssl_data["id"]] = obj
            imported += 1
        self.stdout.write(
            self.style.SUCCESS(f"  Imported {imported} strength series logs")
        )
        return id_map

    def import_cardio_series_logs(self, cardio_series_logs, exercise_map, workout_map):
        """Return {json_id: CardioSeriesLog} map."""
        id_map = {}
        imported = 0
        for csl_data in cardio_series_logs:
            exercise = exercise_map.get(csl_data["exercise_id"])
            workout = workout_map.get(csl_data["workout_id"])
            if not exercise or not workout:
                self.stdout.write(
                    self.style.WARNING(
                        f"  Skipping cardio series log "
                        f"(exercise_id={csl_data['exercise_id']}, "
                        f"workout_id={csl_data['workout_id']}): "
                        f"exercise or workout not found in map"
                    )
                )
                continue
            obj, _ = CardioSeriesLog.objects.update_or_create(
                exercise=exercise,
                workout=workout,
                series_number=csl_data["series_number"],
                defaults={
                    "duration_seconds": csl_data.get("duration_seconds"),
                    "distance_m": csl_data.get("distance_m"),
                },
            )
            if "id" in csl_data:
                id_map[csl_data["id"]] = obj
            imported += 1
        self.stdout.write(
            self.style.SUCCESS(f"  Imported {imported} cardio series logs")
        )
        return id_map

    def import_one_exercices(self, one_exercices, exercise_map, workout_map):
        imported = 0
        for oe_data in one_exercices:
            exercise = exercise_map.get(oe_data["exercise_id"])
            workout = workout_map.get(oe_data["workout_id"])
            if not exercise or not workout:
                self.stdout.write(
                    self.style.WARNING(
                        f"  Skipping OneExercice "
                        f"(exercise_id={oe_data['exercise_id']}, "
                        f"workout_id={oe_data['workout_id']}): "
                        f"exercise or workout not found in map"
                    )
                )
                continue

            OneExercice.objects.update_or_create(
                seance=workout,
                position=oe_data["position"],
                defaults={"name": exercise},
            )
            imported += 1
        self.stdout.write(self.style.SUCCESS(f"  Imported {imported} one exercices"))

    def import_workout_templates(self, workout_templates, type_workout_map):
        """Return {json_id: WorkoutTemplate} map."""
        id_map = {}
        for wt_data in workout_templates:
            type_workout = type_workout_map.get(wt_data.get("type_workout_id"))
            obj, _ = WorkoutTemplate.objects.update_or_create(
                name=wt_data["name"],
                defaults={
                    "type_workout": type_workout,
                    "duration": wt_data.get("duration", 0),
                    "is_active": wt_data.get("is_active", True),
                },
            )
            id_map[wt_data["id"]] = obj
        self.stdout.write(
            self.style.SUCCESS(f"  Imported {len(workout_templates)} workout templates")
        )
        return id_map

    def import_template_exercises(self, template_exercises, template_map, exercise_map):
        """Return {json_id: TemplateExercise} map."""
        id_map = {}
        imported = 0
        for te_data in template_exercises:
            template = template_map.get(te_data["template_id"])
            exercise = exercise_map.get(te_data["exercise_id"])
            if not template or not exercise:
                self.stdout.write(
                    self.style.WARNING(
                        f"  Skipping TemplateExercise "
                        f"(template_id={te_data['template_id']}, "
                        f"exercise_id={te_data['exercise_id']}): "
                        f"template or exercise not found in map"
                    )
                )
                continue
            obj, _ = TemplateExercise.objects.update_or_create(
                template=template,
                position=te_data["position"],
                defaults={"exercise": exercise},
            )
            id_map[te_data["id"]] = obj
            imported += 1
        self.stdout.write(
            self.style.SUCCESS(f"  Imported {imported} template exercises")
        )
        return id_map

    def import_template_strength_series(
        self, template_strength_series, template_exercise_map
    ):
        imported = 0
        for tss_data in template_strength_series:
            template_exercise = template_exercise_map.get(
                tss_data["template_exercise_id"]
            )
            if not template_exercise:
                self.stdout.write(
                    self.style.WARNING(
                        f"  Skipping TemplateStrengthSeries "
                        f"(template_exercise_id={tss_data['template_exercise_id']}): "
                        f"template exercise not found in map"
                    )
                )
                continue
            TemplateStrengthSeries.objects.update_or_create(
                template_exercise=template_exercise,
                series_number=tss_data["series_number"],
                defaults={
                    "reps": tss_data.get("reps"),
                    "weight": tss_data.get("weight"),
                },
            )
            imported += 1
        self.stdout.write(
            self.style.SUCCESS(f"  Imported {imported} template strength series")
        )

    def import_template_cardio_series(
        self, template_cardio_series, template_exercise_map
    ):
        imported = 0
        for tcs_data in template_cardio_series:
            template_exercise = template_exercise_map.get(
                tcs_data["template_exercise_id"]
            )
            if not template_exercise:
                self.stdout.write(
                    self.style.WARNING(
                        f"  Skipping TemplateCardioSeries "
                        f"(template_exercise_id={tcs_data['template_exercise_id']}): "
                        f"template exercise not found in map"
                    )
                )
                continue
            TemplateCardioSeries.objects.update_or_create(
                template_exercise=template_exercise,
                series_number=tcs_data["series_number"],
                defaults={
                    "duration_seconds": tcs_data.get("duration_seconds"),
                    "distance_m": tcs_data.get("distance_m"),
                },
            )
            imported += 1
        self.stdout.write(
            self.style.SUCCESS(f"  Imported {imported} template cardio series")
        )

    def convert_legacy_strength_logs(self, strength_exercise_logs):
        """Expand old aggregated strength logs into per-series dicts.

        A single StrengthExerciseLog with nb_series=3 becomes three entries
        with series_number 1, 2, 3, each carrying the same reps and weight.
        Multiple logs for the same (exercise_id, workout_id) are numbered
        sequentially without collision.
        """
        series_counter: dict = {}  # (exercise_id, workout_id) -> next series_number
        converted = []
        for sl in strength_exercise_logs:
            key = (sl["exercise_id"], sl["workout_id"])
            next_num = series_counter.get(key, 1)
            nb_series = sl.get("nb_series", 1)
            for i in range(nb_series):
                converted.append(
                    {
                        "exercise_id": sl["exercise_id"],
                        "workout_id": sl["workout_id"],
                        "series_number": next_num + i,
                        "reps": sl.get("nb_repetition"),
                        "weight": sl.get("weight"),
                    }
                )
            series_counter[key] = next_num + nb_series
        return converted

    def convert_legacy_cardio_logs(self, cardio_exercise_logs):
        """Convert old aggregated cardio logs into per-series dicts.

        Each CardioExerciseLog becomes one series entry (series_number=1).
        Multiple logs for the same (exercise_id, workout_id) are numbered
        sequentially without collision.
        """
        series_counter: dict = {}  # (exercise_id, workout_id) -> next series_number
        converted = []
        for cl in cardio_exercise_logs:
            key = (cl["exercise_id"], cl["workout_id"])
            next_num = series_counter.get(key, 1)
            converted.append(
                {
                    "exercise_id": cl["exercise_id"],
                    "workout_id": cl["workout_id"],
                    "series_number": next_num,
                    "duration_seconds": cl.get("duration_seconds"),
                    "distance_m": cl.get("distance_m"),
                }
            )
            series_counter[key] = next_num + 1
        return converted
