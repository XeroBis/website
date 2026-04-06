from django.conf import settings
from django.db import models


class TypeWorkout(models.Model):
    name_workout = models.CharField(max_length=50)

    class Meta:
        ordering = ["name_workout"]

    def __str__(self):
        return self.name_workout


class MuscleGroup(models.Model):
    name = models.CharField(max_length=50, unique=True)
    description = models.TextField(blank=True, null=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Equipment(models.Model):
    name = models.CharField(max_length=50, unique=True)
    description = models.TextField(blank=True, null=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "Equipment"

    def __str__(self):
        return self.name


class Workout(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True
    )
    date = models.DateField()
    type_workout = models.ForeignKey(TypeWorkout, null=True, on_delete=models.SET_NULL)
    duration = models.IntegerField(default=0)

    def __str__(self):
        date_str = self.date.strftime("%Y-%m-%d")
        type_workout_name = (
            self.type_workout.name_workout if self.type_workout else "No Type"
        )

        return f"{date_str} - {type_workout_name}"


class Exercice(models.Model):
    """
    Exercice global
    """

    DIFFICULTY_CHOICES = [
        ("beginner", "Beginner"),
        ("intermediate", "Intermediate"),
        ("advanced", "Advanced"),
    ]

    name = models.CharField(max_length=50)
    exercise_type = models.CharField(
        max_length=20,
        choices=[("strength", "Strength"), ("cardio", "Cardio")],
        default="strength",
    )

    # Many-to-many relationships for exercise library
    muscle_groups = models.ManyToManyField(
        MuscleGroup,
        blank=True,
        related_name="exercises",
        help_text="Muscle groups targeted by this exercise",
    )
    equipment = models.ManyToManyField(
        Equipment,
        blank=True,
        related_name="exercises",
        help_text="Equipment required for this exercise",
    )

    # Exercise details
    difficulty = models.CharField(
        max_length=20,
        choices=DIFFICULTY_CHOICES,
        default="beginner",
        help_text="Exercise difficulty level",
    )

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class StrengthSeriesLog(models.Model):
    """
    Series-based strength exercise log - one row per series
    """

    exercise = models.ForeignKey(
        Exercice, on_delete=models.CASCADE, related_name="strength_series_logs"
    )
    workout = models.ForeignKey(
        Workout, on_delete=models.CASCADE, related_name="strength_series_logs"
    )
    series_number = models.IntegerField()  # 1, 2, 3, etc.
    reps = models.IntegerField()
    weight = models.IntegerField()

    class Meta:
        ordering = ["workout", "exercise", "series_number"]

    def __str__(self):
        return f"{self.exercise.name} - Series {self.series_number}: {self.reps}x{self.weight}kg"


class CardioSeriesLog(models.Model):
    """
    Series-based cardio exercise log - one row per interval/set
    """

    exercise = models.ForeignKey(
        Exercice, on_delete=models.CASCADE, related_name="cardio_series_logs"
    )
    workout = models.ForeignKey(
        Workout, on_delete=models.CASCADE, related_name="cardio_series_logs"
    )
    series_number = models.IntegerField()  # 1, 2, 3, etc. for intervals
    duration_seconds = models.IntegerField(null=True, blank=True)
    distance_m = models.FloatField(null=True, blank=True)

    class Meta:
        ordering = ["workout", "exercise", "series_number"]

    def __str__(self):
        distance_str = f" - {self.distance_m}m" if self.distance_m else ""
        return f"{self.exercise.name} - Interval {self.series_number}: {self.duration_seconds}s{distance_str}"


class OneExercice(models.Model):
    """
    Polymorphic exercise log using generic foreign key
    """

    name = models.ForeignKey(Exercice, on_delete=models.CASCADE)
    seance = models.ForeignKey(Workout, on_delete=models.CASCADE)
    position = models.IntegerField(default=1)

    class Meta:
        ordering = ["seance", "position"]

    def __str__(self):
        exercice_name = self.name.name if self.name else "No Exercice"
        seance_date = (
            self.seance.date.strftime("%Y-%m-%d") if self.seance else "No Seance"
        )

        return f"{self.position}. {exercice_name} - {seance_date}"


class WorkoutTemplate(models.Model):
    """
    Template for workout structures - private templates per user
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True
    )
    name = models.CharField(max_length=100)
    type_workout = models.ForeignKey(TypeWorkout, null=True, on_delete=models.SET_NULL)
    duration = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        type_name = self.type_workout.name_workout if self.type_workout else "No Type"
        return f"{self.name} - {type_name}"


class TemplateExercise(models.Model):
    """
    Exercise within a workout template
    """

    template = models.ForeignKey(WorkoutTemplate, on_delete=models.CASCADE)
    exercise = models.ForeignKey(Exercice, on_delete=models.CASCADE)
    position = models.IntegerField()

    class Meta:
        ordering = ["position"]

    def __str__(self):
        return f"{self.position}. {self.exercise.name} - {self.template.name}"


class TemplateStrengthSeries(models.Model):
    """
    Strength series data for template exercises
    """

    template_exercise = models.ForeignKey(TemplateExercise, on_delete=models.CASCADE)
    series_number = models.IntegerField()
    reps = models.IntegerField()
    weight = models.IntegerField()

    class Meta:
        ordering = ["template_exercise__position", "series_number"]
        verbose_name_plural = "Template Strength Series"

    def __str__(self):
        return f"{self.template_exercise.exercise.name} - Series {self.series_number}: {self.reps}x{self.weight}kg"


class TemplateCardioSeries(models.Model):
    """
    Cardio series data for template exercises
    """

    template_exercise = models.ForeignKey(TemplateExercise, on_delete=models.CASCADE)
    series_number = models.IntegerField()
    duration_seconds = models.IntegerField(null=True, blank=True)
    distance_m = models.FloatField(null=True, blank=True)

    class Meta:
        ordering = ["template_exercise__position", "series_number"]
        verbose_name_plural = "Template Cardio Series"

    def __str__(self):
        distance_str = f" - {self.distance_m}m" if self.distance_m else ""
        return f"{self.template_exercise.exercise.name} - Interval {self.series_number}: {self.duration_seconds}s{distance_str}"
