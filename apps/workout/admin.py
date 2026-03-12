import nested_admin
from django.contrib import admin
from django.db.models import OuterRef, Subquery

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


@admin.register(Equipment)
class EquipmentAdmin(admin.ModelAdmin):
    list_display = ["name", "description"]
    search_fields = ["name"]
    list_filter = ["name"]


@admin.register(MuscleGroup)
class MuscleGroupAdmin(admin.ModelAdmin):
    list_display = ["name", "description"]
    search_fields = ["name"]
    list_filter = ["name"]


@admin.register(TypeWorkout)
class TypeWorkoutAdmin(admin.ModelAdmin):
    list_display = ["name_workout"]
    search_fields = ["name_workout"]
    list_filter = ["name_workout"]


@admin.register(Exercice)
class ExerciceAdmin(admin.ModelAdmin):
    list_display = [
        "name",
        "exercise_type",
        "difficulty",
        "get_muscle_groups",
        "get_equipment",
    ]
    search_fields = ["name"]
    list_filter = ["exercise_type", "difficulty"]
    filter_horizontal = ["muscle_groups", "equipment"]

    @admin.display(description="Muscle Groups")
    def get_muscle_groups(self, obj):
        return ", ".join([mg.name for mg in obj.muscle_groups.all()])

    @admin.display(description="Equipment")
    def get_equipment(self, obj):
        return ", ".join([eq.name for eq in obj.equipment.all()])


class StrengthSeriesLogInline(admin.TabularInline):
    model = StrengthSeriesLog
    extra = 1
    fields = ["exercise", "series_number", "reps", "weight"]

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        position_subquery = OneExercice.objects.filter(
            name=OuterRef("exercise"),
            seance=OuterRef("workout"),
        ).values("position")[:1]
        return qs.annotate(exercise_position=Subquery(position_subquery)).order_by(
            "exercise_position", "series_number"
        )


class CardioSeriesLogInline(admin.TabularInline):
    model = CardioSeriesLog
    extra = 1
    fields = ["exercise", "series_number", "duration_seconds", "distance_m"]

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        position_subquery = OneExercice.objects.filter(
            name=OuterRef("exercise"),
            seance=OuterRef("workout"),
        ).values("position")[:1]
        return qs.annotate(exercise_position=Subquery(position_subquery)).order_by(
            "exercise_position", "series_number"
        )


class OneExerciceInline(admin.TabularInline):
    model = OneExercice
    extra = 1
    fields = ["position", "name"]
    ordering = ["position"]


@admin.register(Workout)
class WorkoutAdmin(admin.ModelAdmin):
    list_display = ["date", "type_workout", "duration", "get_exercise_count"]
    search_fields = ["date", "type_workout__name_workout"]
    list_filter = ["date", "type_workout", "duration"]
    fieldsets = ((None, {"fields": ("date", "type_workout", "duration")}),)
    inlines = [OneExerciceInline, StrengthSeriesLogInline, CardioSeriesLogInline]

    @admin.display(description="Exercises")
    def get_exercise_count(self, obj):
        strength_count = obj.strength_series_logs.count()
        cardio_count = obj.cardio_series_logs.count()
        total = strength_count + cardio_count
        return f"{total} ({strength_count}S, {cardio_count}C)"


class TemplateStrengthSeriesInline(nested_admin.NestedTabularInline):
    model = TemplateStrengthSeries
    extra = 1
    fields = ["series_number", "reps", "weight"]
    ordering = ["series_number"]


class TemplateCardioSeriesInline(nested_admin.NestedTabularInline):
    model = TemplateCardioSeries
    extra = 1
    fields = ["series_number", "duration_seconds", "distance_m"]
    ordering = ["series_number"]


class TemplateStrengthExerciseInline(nested_admin.NestedTabularInline):
    model = TemplateExercise
    verbose_name = "Strength Exercise"
    verbose_name_plural = "Strength Exercises"
    extra = 1
    fields = ["position", "exercise"]
    ordering = ["position"]
    inlines = [TemplateStrengthSeriesInline]

    def get_queryset(self, request):
        return super().get_queryset(request).filter(exercise__exercise_type="strength")

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "exercise":
            kwargs["queryset"] = Exercice.objects.filter(exercise_type="strength")
        return super().formfield_for_foreignkey(db_field, request, **kwargs)


class TemplateCardioExerciseInline(nested_admin.NestedTabularInline):
    model = TemplateExercise
    verbose_name = "Cardio Exercise"
    verbose_name_plural = "Cardio Exercises"
    extra = 1
    fields = ["position", "exercise"]
    ordering = ["position"]
    inlines = [TemplateCardioSeriesInline]

    def get_queryset(self, request):
        return super().get_queryset(request).filter(exercise__exercise_type="cardio")

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "exercise":
            kwargs["queryset"] = Exercice.objects.filter(exercise_type="cardio")
        return super().formfield_for_foreignkey(db_field, request, **kwargs)


@admin.register(WorkoutTemplate)
class WorkoutTemplateAdmin(nested_admin.NestedModelAdmin):
    list_display = ["name", "type_workout", "duration", "is_active", "created_at"]
    search_fields = ["name", "type_workout__name_workout"]
    list_filter = ["type_workout", "is_active", "created_at"]
    fieldsets = ((None, {"fields": ("name", "type_workout", "duration", "is_active")}),)
    inlines = [TemplateStrengthExerciseInline, TemplateCardioExerciseInline]
