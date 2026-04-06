import { buildAndAppendExercises, loadWorkoutTypes } from './workout-exercise-shared.js';

function changeWorkoutType() {
    const selectedType = document.getElementById('add_workout_type_workout').value;
    document.getElementById('add_workout_template_select').value = '';

    if (selectedType) {
        fetch(`/workout/get_last_workout/?type=${selectedType}`)
            .then(response => response.json())
            .then(data => {
                if (data.date) {
                    document.getElementById('add_workout_date').value = data.date;
                }
                const exercisesContainer = document.getElementById('exercises');
                exercisesContainer.innerHTML = '';
                if (data.exercises && data.exercises.length > 0) {
                    buildAndAppendExercises(exercisesContainer, data.exercises, data.all_exercises);
                }
            });
    }
}

function loadTemplateList() {
    const templateSelect = document.getElementById('add_workout_template_select');
    if (!templateSelect) return;

    const translations = JSON.parse(document.getElementById('add-workout-translations').textContent);

    fetch('/workout/get_template_list/')
        .then(response => response.json())
        .then(data => {
            templateSelect.innerHTML = `<option value="">${translations.no_template}</option>`;
            data.templates.forEach(template => {
                const option = document.createElement('option');
                option.value = template.id;
                option.textContent = `${template.name} (${template.type})`;
                templateSelect.appendChild(option);
            });
        })
        .catch(error => console.error('Error loading templates:', error));
}

function loadTemplate() {
    const templateId = document.getElementById('add_workout_template_select').value;
    if (!templateId) return;

    fetch(`/workout/get_template_details/?template_id=${templateId}`)
        .then(response => response.json())
        .then(data => {
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('add_workout_date').value = today;
            if (data.type_workout) {
                document.getElementById('add_workout_type_workout').value = data.type_workout;
            }
            document.getElementById('add_workout_duration').value = data.duration;

            const exercisesContainer = document.getElementById('exercises');
            exercisesContainer.innerHTML = '';
            if (data.exercises && data.exercises.length > 0) {
                buildAndAppendExercises(exercisesContainer, data.exercises, data.all_exercises);
            }
        })
        .catch(error => console.error('Error loading template:', error));
}

document.addEventListener('DOMContentLoaded', function() {
    loadWorkoutTypes();
    loadTemplateList();
    document.getElementById('add_workout_type_workout').addEventListener('change', changeWorkoutType);
    document.getElementById('add_workout_template_select').addEventListener('change', loadTemplate);
});
