import { buildAndAppendExercises, loadWorkoutTypes } from './workout-exercise-shared.js';

function populateWorkoutData() {
    const workout = JSON.parse(document.getElementById('workout-data').textContent);
    const exercises = JSON.parse(document.getElementById('exercises-data').textContent);
    const all_exercises = JSON.parse(document.getElementById('all-exercises-data').textContent);

    if (!workout) {
        console.error('No workout data found');
        return;
    }

    const typeSelect = document.getElementById('add_workout_type_workout');
    if (typeSelect && workout.type_workout) {
        typeSelect.value = workout.type_workout;
    }

    const exercisesContainer = document.getElementById('exercises');
    if (!exercisesContainer) {
        console.error('Exercises container not found');
        return;
    }

    exercisesContainer.innerHTML = '';
    if (exercises && exercises.length > 0) {
        buildAndAppendExercises(exercisesContainer, exercises, all_exercises);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    loadWorkoutTypes();
    populateWorkoutData();
});
