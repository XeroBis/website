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
    help = "Clear all workout data from the database"

    def add_arguments(self, parser):
        parser.add_argument(
            "--no-input",
            action="store_true",
            help="Skip confirmation prompt",
        )

    def handle(self, *args, **kwargs):
        no_input = kwargs.get("no_input", False)

        # Count records before deletion
        counts = {
            "TemplateStrengthSeries": TemplateStrengthSeries.objects.count(),
            "TemplateCardioSeries": TemplateCardioSeries.objects.count(),
            "TemplateExercise": TemplateExercise.objects.count(),
            "WorkoutTemplate": WorkoutTemplate.objects.count(),
            "StrengthSeriesLog": StrengthSeriesLog.objects.count(),
            "CardioSeriesLog": CardioSeriesLog.objects.count(),
            "OneExercice": OneExercice.objects.count(),
            "Workout": Workout.objects.count(),
            "Exercice": Exercice.objects.count(),
            "Equipment": Equipment.objects.count(),
            "MuscleGroup": MuscleGroup.objects.count(),
            "TypeWorkout": TypeWorkout.objects.count(),
        }

        total = sum(counts.values())

        if total == 0:
            self.stdout.write(self.style.WARNING("No workout data to clear."))
            return

        self.stdout.write(self.style.WARNING(f"\nThis will delete {total} records:"))
        for model_name, count in counts.items():
            if count > 0:
                self.stdout.write(f"  - {model_name}: {count}")

        if not no_input:
            confirm = input(
                "\nAre you sure you want to delete all this data? (yes/no): "
            )
            if confirm.lower() != "yes":
                self.stdout.write(self.style.WARNING("Operation cancelled."))
                return

        TemplateStrengthSeries.objects.all().delete()
        TemplateCardioSeries.objects.all().delete()
        TemplateExercise.objects.all().delete()
        WorkoutTemplate.objects.all().delete()
        StrengthSeriesLog.objects.all().delete()
        CardioSeriesLog.objects.all().delete()
        OneExercice.objects.all().delete()
        Workout.objects.all().delete()
        Exercice.objects.all().delete()
        Equipment.objects.all().delete()
        MuscleGroup.objects.all().delete()
        TypeWorkout.objects.all().delete()

        self.stdout.write(
            self.style.SUCCESS(
                f"\nSuccessfully cleared all workout data ({total} records deleted)."
            )
        )
