function createExerciseElement(index, exerciseName, allExercises) {
    const exerciseDiv = document.createElement('div');
    exerciseDiv.className = 'exercise';
    exerciseDiv.id = `exercise_row_${index}`;
    exerciseDiv.innerHTML = `
        <div class="exercise-name-header">
            <div class="exercise-position-number">${index + 1}.</div>
            <div class="exercise-search-container">
                <input type="text" class="workout_input exercise-search-input"
                       id="exercise_${index}_search"
                       value="${exerciseName}"
                       placeholder="Search exercise..."
                       onkeyup="filterExercises(${index})"
                       onfocus="showExerciseDropdown(${index})"
                       onblur="hideExerciseDropdown(${index})">
                <input type="hidden" id="exercise_${index}_name" name="exercise_${index}_name" value="${exerciseName}" required>
                <div class="exercise-dropdown" id="exercise_${index}_dropdown" style="display: none;">
                    ${allExercises.map(ex => `<div class="exercise-option" data-name="${ex.name}" data-type="${ex.exercise_type}" onclick="selectExercise(${index}, '${ex.name}', '${ex.exercise_type}')">${ex.name}</div>`).join('')}
                </div>
            </div>
            <button type="button" class="add_workout_btn_delete" onclick="deleteExercise(${index})">❌</button>
        </div>
        <div id="exercise_${index}_fields" class="exercise-fields"></div>
    `;
    return exerciseDiv;
}

function buildStrengthSeriesHTML(exerciseIndex, seriesNumber, reps, weight, translations) {
    return `
        <div class="series-item" id="exercise_${exerciseIndex}_series_${seriesNumber}">
            <div class="series-number">${translations.series} ${seriesNumber}</div>
            <div class="series-fields">
                <div class="input-group">
                    <label class="input-label">${translations.reps}</label>
                    <input type="number" class="workout_input" name="exercise_${exerciseIndex}_series_${seriesNumber}_reps" value="${reps}" required>
                </div>
                <div class="input-group">
                    <label class="input-label">${translations.weight_kg}</label>
                    <input type="number" class="workout_input" name="exercise_${exerciseIndex}_series_${seriesNumber}_weight" value="${weight}">
                </div>
                <button type="button" class="add_workout_btn_delete" onclick="deleteSeries(${exerciseIndex}, ${seriesNumber})">❌</button>
            </div>
        </div>
    `;
}

function buildCardioSeriesHTML(exerciseIndex, seriesNumber, durationSeconds, distanceM, translations) {
    return `
        <div class="series-item" id="exercise_${exerciseIndex}_series_${seriesNumber}">
            <div class="series-number">Interval ${seriesNumber}</div>
            <div class="series-fields">
                <div class="input-group">
                    <label class="input-label">${translations.duration_sec}</label>
                    <input type="number" class="workout_input" name="exercise_${exerciseIndex}_series_${seriesNumber}_duration_seconds" value="${durationSeconds || ''}">
                </div>
                <div class="input-group">
                    <label class="input-label">${translations.distance_m}</label>
                    <input type="number" class="workout_input" name="exercise_${exerciseIndex}_series_${seriesNumber}_distance_m" value="${distanceM || ''}">
                </div>
                <button type="button" class="add_workout_btn_delete" onclick="deleteSeries(${exerciseIndex}, ${seriesNumber})">❌</button>
            </div>
        </div>
    `;
}

function populateExerciseFields(fieldsContainer, exercise, index, translations) {
    if (exercise.exercise_type === 'strength') {
        fieldsContainer.innerHTML = `
            <div class="series-container" id="exercise_${index}_series_container">
                <div class="series-header">
                    <h4>${translations.series}:</h4>
                    <button type="button" class="cliquable button_add_series" onclick="addSeries(${index}, 'strength')">+ ${translations.series}</button>
                </div>
                <div class="series-list" id="exercise_${index}_series_list"></div>
            </div>
        `;
        const seriesList = fieldsContainer.querySelector(`#exercise_${index}_series_list`);
        exercise.series.forEach((series) => {
            seriesList.insertAdjacentHTML('beforeend', buildStrengthSeriesHTML(index, series.series_number, series.reps, series.weight, translations));
        });
    } else if (exercise.exercise_type === 'cardio') {
        fieldsContainer.innerHTML = `
            <div class="series-container" id="exercise_${index}_series_container">
                <div class="series-header">
                    <h4>Intervals:</h4>
                    <button type="button" class="cliquable button_add_series" onclick="addSeries(${index}, 'cardio')">+ Interval</button>
                </div>
                <div class="series-list" id="exercise_${index}_series_list"></div>
            </div>
        `;
        const seriesList = fieldsContainer.querySelector(`#exercise_${index}_series_list`);
        exercise.series.forEach((series) => {
            seriesList.insertAdjacentHTML('beforeend', buildCardioSeriesHTML(index, series.series_number, series.duration_seconds, series.distance_m, translations));
        });
    }
}

function buildAndAppendExercises(exercisesContainer, exercises, allExercises) {
    const translations = JSON.parse(document.getElementById('add-workout-translations').textContent);
    exercises.forEach((exercise, index) => {
        const exerciseDiv = createExerciseElement(index, exercise.name, allExercises);
        exercisesContainer.appendChild(exerciseDiv);
        const fieldsContainer = exerciseDiv.querySelector(`#exercise_${index}_fields`);
        populateExerciseFields(fieldsContainer, exercise, index, translations);
    });
}

function addExercice() {
    fetch('/workout/get_list_exercice/')
        .then(response => response.json())
        .then(data => {
            const exercisesContainer = document.getElementById('exercises');
            const exerciseCount = document.querySelectorAll('.exercise').length;
            const exerciseDiv = createExerciseElement(exerciseCount, '', data.all_exercises);
            exercisesContainer.appendChild(exerciseDiv);
        });
}

function deleteExercise(index) {
    const exerciseRow = document.getElementById(`exercise_row_${index}`);
    if (exerciseRow) {
        exerciseRow.remove();
        renumberExercises();
    }
}

function renumberExercises() {
    const exercisesContainer = document.getElementById('exercises');
    const exercises = exercisesContainer.querySelectorAll('.exercise');

    exercises.forEach((exercise, newIndex) => {
        const oldIndex = parseInt(exercise.id.replace('exercise_row_', ''));

        if (oldIndex !== newIndex) {
            exercise.id = `exercise_row_${newIndex}`;

            const positionNumber = exercise.querySelector('.exercise-position-number');
            if (positionNumber) {
                positionNumber.textContent = `${newIndex + 1}.`;
            }

            const searchInput = exercise.querySelector('.exercise-search-input');
            if (searchInput) {
                searchInput.id = `exercise_${newIndex}_search`;
                searchInput.setAttribute('onkeyup', `filterExercises(${newIndex})`);
                searchInput.setAttribute('onfocus', `showExerciseDropdown(${newIndex})`);
                searchInput.setAttribute('onblur', `hideExerciseDropdown(${newIndex})`);
            }

            const hiddenInput = exercise.querySelector('input[type="hidden"]');
            if (hiddenInput) {
                hiddenInput.id = `exercise_${newIndex}_name`;
                hiddenInput.name = `exercise_${newIndex}_name`;
            }

            const dropdown = exercise.querySelector('.exercise-dropdown');
            if (dropdown) {
                dropdown.id = `exercise_${newIndex}_dropdown`;

                const options = dropdown.querySelectorAll('.exercise-option');
                options.forEach(option => {
                    const exerciseName = option.getAttribute('data-name');
                    const exerciseType = option.getAttribute('data-type');
                    option.setAttribute('onclick', `selectExercise(${newIndex}, '${exerciseName}', '${exerciseType}')`);
                });
            }

            const deleteBtn = exercise.querySelector('.add_workout_btn_delete');
            if (deleteBtn) {
                deleteBtn.setAttribute('onclick', `deleteExercise(${newIndex})`);
            }

            const fieldsContainer = exercise.querySelector('.exercise-fields');
            if (fieldsContainer) {
                fieldsContainer.id = `exercise_${newIndex}_fields`;

                const seriesContainer = fieldsContainer.querySelector('.series-container');
                if (seriesContainer) {
                    seriesContainer.id = `exercise_${newIndex}_series_container`;

                    const seriesList = seriesContainer.querySelector('[id$="_series_list"]');
                    if (seriesList) {
                        seriesList.id = `exercise_${newIndex}_series_list`;

                        const seriesItems = seriesList.querySelectorAll('.series-item');
                        seriesItems.forEach((seriesItem, seriesIndex) => {
                            const seriesNumber = seriesIndex + 1;
                            seriesItem.id = `exercise_${newIndex}_series_${seriesNumber}`;

                            const inputs = seriesItem.querySelectorAll('input[type="number"]');
                            inputs.forEach(input => {
                                const nameParts = input.name.split('_');
                                const fieldName = nameParts.slice(3).join('_');
                                input.name = `exercise_${newIndex}_series_${seriesNumber}_${fieldName}`;
                            });

                            const deleteSeriesBtn = seriesItem.querySelector('.add_workout_btn_delete');
                            if (deleteSeriesBtn) {
                                deleteSeriesBtn.setAttribute('onclick', `deleteSeries(${newIndex}, ${seriesNumber})`);
                            }
                        });
                    }

                    const addSeriesBtn = seriesContainer.querySelector('.button_add_series');
                    if (addSeriesBtn) {
                        const exerciseType = addSeriesBtn.getAttribute('onclick').includes('strength') ? 'strength' : 'cardio';
                        addSeriesBtn.setAttribute('onclick', `addSeries(${newIndex}, '${exerciseType}')`);
                    }
                }
            }
        }
    });
}

function filterExercises(exerciseIndex) {
    const searchInput = document.getElementById(`exercise_${exerciseIndex}_search`);
    const dropdown = document.getElementById(`exercise_${exerciseIndex}_dropdown`);
    const searchTerm = searchInput.value.toLowerCase();

    const options = dropdown.querySelectorAll('.exercise-option');
    options.forEach(option => {
        const exerciseName = option.getAttribute('data-name').toLowerCase();
        option.style.display = exerciseName.includes(searchTerm) ? 'block' : 'none';
    });

    if (searchTerm.length > 0) {
        dropdown.style.display = 'block';
    }
}

function showExerciseDropdown(exerciseIndex) {
    const dropdown = document.getElementById(`exercise_${exerciseIndex}_dropdown`);
    dropdown.style.display = 'block';
}

function hideExerciseDropdown(exerciseIndex) {
    setTimeout(() => {
        const dropdown = document.getElementById(`exercise_${exerciseIndex}_dropdown`);
        dropdown.style.display = 'none';
    }, 200);
}

function selectExercise(exerciseIndex, exerciseName, exerciseType) {
    const searchInput = document.getElementById(`exercise_${exerciseIndex}_search`);
    const hiddenInput = document.getElementById(`exercise_${exerciseIndex}_name`);
    const dropdown = document.getElementById(`exercise_${exerciseIndex}_dropdown`);

    searchInput.value = exerciseName;
    hiddenInput.value = exerciseName;
    dropdown.style.display = 'none';

    updateExerciseFields(exerciseIndex, exerciseType);
}

function updateExerciseFields(exerciseIndex, exerciseType = null) {
    const hiddenInput = document.getElementById(`exercise_${exerciseIndex}_name`);
    const fieldsContainer = document.getElementById(`exercise_${exerciseIndex}_fields`);

    if (!exerciseType && hiddenInput.value) {
        const dropdown = document.getElementById(`exercise_${exerciseIndex}_dropdown`);
        const selectedOption = dropdown.querySelector(`[data-name="${hiddenInput.value}"]`);
        exerciseType = selectedOption ? selectedOption.getAttribute('data-type') : null;
    }

    if (!exerciseType) return;

    const translations = JSON.parse(document.getElementById('add-workout-translations').textContent);
    populateExerciseFields(fieldsContainer, { exercise_type: exerciseType, series: [] }, exerciseIndex, translations);
    addSeries(exerciseIndex, exerciseType);
}

function addSeries(exerciseIndex, exerciseType) {
    const seriesList = document.getElementById(`exercise_${exerciseIndex}_series_list`);
    const seriesCount = seriesList.querySelectorAll('.series-item').length + 1;
    const translations = JSON.parse(document.getElementById('add-workout-translations').textContent);

    if (exerciseType === 'strength') {
        seriesList.insertAdjacentHTML('beforeend', buildStrengthSeriesHTML(exerciseIndex, seriesCount, 8, 0, translations));
    } else if (exerciseType === 'cardio') {
        seriesList.insertAdjacentHTML('beforeend', buildCardioSeriesHTML(exerciseIndex, seriesCount, 1200, '', translations));
    }
}

function deleteSeries(exerciseIndex, seriesNumber) {
    const seriesItem = document.getElementById(`exercise_${exerciseIndex}_series_${seriesNumber}`);
    if (seriesItem) {
        seriesItem.remove();
    }
}

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

function loadWorkoutTypes() {
    fetch('/workout/get_workout_types/')
        .then(response => response.json())
        .then(data => {
            const select = document.getElementById('add_workout_type_workout');
            while (select.children.length > 1) {
                select.removeChild(select.lastChild);
            }
            data.workout_types.forEach(workoutType => {
                const option = document.createElement('option');
                option.value = workoutType.value;
                option.textContent = workoutType.display;
                select.appendChild(option);
            });
        })
        .catch(error => console.error('Error loading workout types:', error));
}

document.addEventListener('DOMContentLoaded', function() {
    loadWorkoutTypes();
    loadTemplateList();
});
