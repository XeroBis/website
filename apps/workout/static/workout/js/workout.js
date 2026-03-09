let isLoading = false;
let hasMoreContent = document.getElementById('load-more') ? true : false;
let currentPage = document.getElementById('load-more') ? parseInt(document.getElementById('load-more').getAttribute('data-next-page')) : null;

// Cache for SVG content
let frontSvgContent = null;
let backSvgContent = null;

// Auto-apply filter delay management
let filterDebounceTimer = null;
const FILTER_DEBOUNCE_DELAY = 500; // milliseconds

// Global exercise index counter to ensure unique IDs across all workouts
let globalExerciseCounter = 0;

// Track last rendered month/year for dynamic load-more separators
let lastRenderedMonthYear = null;

function muscleNameToSvgId(muscleName) {
    let svgId = muscleName.toLowerCase().trim();

    if (svgId === 'lower back') {
        return 'lowerback';
    } else if (svgId === 'traps middle') {
        return 'traps-middle';
    } else if (svgId === 'rear shoulder') {
        return 'rear-shoulder';
    } else if (svgId === 'front shoulders') {
        return 'front-shoulders';
    } else if (svgId === 'hamstring') {
        return 'hamstrings';
    }

    return svgId;
}

async function loadSvgContent() {
    if (!frontSvgContent) {
        const frontResponse = await fetch('/static/images/front.svg');
        frontSvgContent = await frontResponse.text();
    }
    if (!backSvgContent) {
        const backResponse = await fetch('/static/images/back.svg');
        backSvgContent = await backResponse.text();
    }
}


function createMuscleModal() {
    // Create backdrop for mobile
    if (isMobileDevice()) {
        let backdrop = document.getElementById('muscle-modal-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'muscle-modal-backdrop';
            backdrop.className = 'muscle-modal-backdrop';
            backdrop.addEventListener('click', hideMuscleModal);
            document.body.appendChild(backdrop);
        }
    }

    const modal = document.createElement('div');
    modal.id = 'muscle-modal';
    modal.className = 'muscle-modal';
    modal.innerHTML = '<div class="muscle-modal-content"></div>';
    document.body.appendChild(modal);
    return modal;
}


async function showMuscleModal(exerciseRow, muscleGroups) {
    const modal = document.getElementById('muscle-modal') || createMuscleModal();
    const modalContent = modal.querySelector('.muscle-modal-content');

    if (!muscleGroups || muscleGroups.trim() === '') {
        modalContent.innerHTML = '<p>No muscle groups specified</p>';
    } else {
        await loadSvgContent();

        const muscleList = muscleGroups.split(',').map(m => m.trim()).filter(m => m);

        const svgIdsToHighlight = new Set();
        muscleList.forEach(muscle => {
            const svgId = muscleNameToSvgId(muscle);
            svgIdsToHighlight.add(svgId);
        });

        modalContent.innerHTML = `
            <div class="muscle-modal-layout">
                <div class="muscle-list-section">
                    <h3>Muscle Groups</h3>
                    <ul>${muscleList.map(muscle => '<li>' + muscle + '</li>').join('')}</ul>
                </div>
                <div class="muscle-svg-section">
                    <div class="svg-container">
                        <h4>Front</h4>
                        <div class="body-svg">${frontSvgContent}</div>
                    </div>
                    <div class="svg-container">
                        <h4>Back</h4>
                        <div class="body-svg">${backSvgContent}</div>
                    </div>
                </div>
            </div>
        `;

        // Highlight muscles in both SVGs
        svgIdsToHighlight.forEach(id => {
            const allElements = modalContent.querySelectorAll(`.body-svg svg #${id}`);

            allElements.forEach(element => {
                // Apply color to all paths within the group
                const paths = element.querySelectorAll('path');
                paths.forEach(path => {
                    path.style.fill = '#ff6b6b';
                    path.style.opacity = '0.9';
                });
            });
        });
    }

    // Position the modal near the cursor
    modal.style.display = 'block';

    // Show backdrop on mobile
    const backdrop = document.getElementById('muscle-modal-backdrop');
    if (backdrop) {
        backdrop.style.display = 'block';
    }

    // Position the modal relative to the row (only on desktop)
    if (!isMobileDevice()) {
        const rect = exerciseRow.getBoundingClientRect();
        const modalWidth = 700; // max-width from CSS
        const spaceOnRight = window.innerWidth - rect.right;

        // Check if there's enough space on the right
        if (spaceOnRight > modalWidth + 40) {
            // Position to the right (original behavior)
            modal.style.top = (rect.top + window.scrollY - 10) + 'px';
            modal.style.left = (rect.right + 20) + 'px';
            modal.style.transform = 'none';
        } else {
            // Position above/below the exercise (centered horizontally)
            const rowCenter = rect.left + (rect.width / 2);
            modal.style.left = rowCenter + 'px';
            modal.style.transform = 'translateX(-50%)';

            // Wait for modal to render to get accurate height
            requestAnimationFrame(() => {
                const modalHeight = modal.offsetHeight;
                const spaceAbove = rect.top;
                const spaceBelow = window.innerHeight - rect.bottom;

                // Position above if there's more space above and enough room
                if (spaceAbove > spaceBelow && spaceAbove > modalHeight + 20) {
                    modal.style.top = (rect.top + window.scrollY - modalHeight - 10) + 'px';
                } else {
                    // Position below
                    modal.style.top = (rect.bottom + window.scrollY + 10) + 'px';
                }
            });
        }
    }
}

// Hide muscle modal
function hideMuscleModal() {
    const modal = document.getElementById('muscle-modal');
    if (modal) {
        modal.style.display = 'none';
    }

    // Hide backdrop on mobile
    const backdrop = document.getElementById('muscle-modal-backdrop');
    if (backdrop) {
        backdrop.style.display = 'none';
    }
}

// Check if device is mobile
function isMobileDevice() {
    return window.matchMedia('(max-width: 768px)').matches ||
           /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// Attach event listeners to exercise names using event delegation
function attachHoverListeners() {
    const isMobile = isMobileDevice();
    const workoutList = document.getElementById('workout-list');

    if (!workoutList) return;

    // Only attach once via event delegation
    if (workoutList.dataset.listenersAttached === 'true') {
        return;
    }

    if (isMobile) {
        // On mobile: click on the section shows SVG modal
        workoutList.addEventListener('click', function(e) {
            const section = e.target.closest('.exercise-name-section');
            if (section) {
                handleNameClick.call(section, e);
            }
        });
    } else {
        // On desktop: hover shows SVG modal, click toggles series
        workoutList.addEventListener('mouseenter', function(e) {
            const section = e.target.closest('.exercise-name-section');
            if (section) {
                handleMouseEnter.call(section, e);
            }
        }, true);

        workoutList.addEventListener('mouseleave', function(e) {
            const section = e.target.closest('.exercise-name-section');
            if (section) {
                handleMouseLeave.call(section, e);
            }
        }, true);

        workoutList.addEventListener('click', function(e) {
            const section = e.target.closest('.exercise-name-section');
            if (section) {
                handleToggleClickFromName.call(section, e);
            }
        });
    }

    workoutList.dataset.listenersAttached = 'true';
}

// Attach toggle listeners for collapsible series
function attachToggleListeners() {
    // Listen only to the arrow button for toggling
    document.querySelectorAll('.toggle-series-btn').forEach(btn => {
        btn.removeEventListener('click', handleToggleClick);
        btn.addEventListener('click', handleToggleClick);
    });
}

function handleToggleClick(e) {
    e.preventDefault();
    e.stopPropagation();

    const exerciseId = this.getAttribute('data-exercise-id');
    const table = document.getElementById(exerciseId);

    if (table) {
        const isHidden = table.classList.contains('series-collapsed');
        if (isHidden) {
            table.classList.remove('series-collapsed');
            this.textContent = '▼';
        } else {
            table.classList.add('series-collapsed');
            this.textContent = '▶';
        }
    }
}


function handleMouseEnter() {
    // Get muscle groups from the associated exercise row
    const table = document.getElementById(this.querySelector('.toggle-series-btn').getAttribute('data-exercise-id'));
    const muscleGroups = table ? table.querySelector('.exercise-row')?.getAttribute('data-muscle-groups') : '';
    showMuscleModal(this, muscleGroups);
}

function handleMouseLeave() {
    hideMuscleModal();
}

function handleNameClick(e) {
    e.preventDefault();
    e.stopPropagation();

    // Get muscle groups from the associated exercise row
    const table = document.getElementById(this.querySelector('.toggle-series-btn').getAttribute('data-exercise-id'));
    const muscleGroups = table ? table.querySelector('.exercise-row')?.getAttribute('data-muscle-groups') : '';
    const modal = document.getElementById('muscle-modal');

    // If modal is already visible for this section, hide it
    if (modal && modal.style.display === 'block' && modal.dataset.currentRow === this.dataset.rowId) {
        hideMuscleModal();
    } else {
        // Show modal for this section
        if (!this.dataset.rowId) {
            this.dataset.rowId = 'row-' + Math.random().toString(36).slice(2, 11);
        }
        showMuscleModal(this, muscleGroups);
        if (modal) {
            modal.dataset.currentRow = this.dataset.rowId;
        }
    }
}

function handleToggleClickFromName(e) {
    // Don't toggle if clicking on the arrow button (it has its own handler)
    if (e.target === this.querySelector('.toggle-series-btn')) {
        return;
    }

    e.preventDefault();
    e.stopPropagation();

    const btn = this.querySelector('.toggle-series-btn');
    const exerciseId = btn.getAttribute('data-exercise-id');
    const table = document.getElementById(exerciseId);

    if (table) {
        const isHidden = table.classList.contains('series-collapsed');
        if (isHidden) {
            table.classList.remove('series-collapsed');
            btn.textContent = '▼';
        } else {
            table.classList.add('series-collapsed');
            btn.textContent = '▶';
        }
    }
}

const MAX_VISIBLE_EXERCISES = 3;

function applyExerciseLimits(workoutItem) {
    const sections = workoutItem.querySelectorAll('.exercise-name-section');
    if (sections.length <= MAX_VISIBLE_EXERCISES) return;

    const hiddenCount = sections.length - MAX_VISIBLE_EXERCISES;

    const toHide = [];
    for (let i = MAX_VISIBLE_EXERCISES; i < sections.length; i++) {
        toHide.push(sections[i]);
        const next = sections[i].nextElementSibling;
        if (next && next.classList.contains('series-table')) {
            toHide.push(next);
        }
    }
    toHide.forEach(el => el.classList.add('exercise-hidden'));

    const thirdSection = sections[MAX_VISIBLE_EXERCISES - 1];
    const thirdTable = thirdSection.nextElementSibling;
    const anchor = (thirdTable && thirdTable.classList.contains('series-table')) ? thirdTable : thirdSection;

    const translations = JSON.parse(document.getElementById('workout-translations').textContent);
    const btn = document.createElement('button');
    btn.className = 'show-more-exercises-btn cliquable';
    btn.textContent = '+ ' + hiddenCount + ' ' + (translations.more_exercises || 'more exercises');
    btn.addEventListener('click', function () {
        toHide.forEach(el => el.classList.remove('exercise-hidden'));
        btn.remove();
    });
    anchor.after(btn);
}

function groupExercisesByType(exercises) {
    var groups = [];
    var currentGroup = [];
    var currentType = null;

    exercises.forEach(function (exercise) {
        if (currentType !== exercise.exercise_type) {
            if (currentGroup.length > 0) {
                groups.push({ type: currentType, exercises: currentGroup });
            }
            currentGroup = [exercise];
            currentType = exercise.exercise_type;
        } else {
            currentGroup.push(exercise);
        }
    });

    if (currentGroup.length > 0) {
        groups.push({ type: currentType, exercises: currentGroup });
    }

    return groups;
}

function buildWorkoutHTML(workoutDataArray, translations) {
    var html = '';

    workoutDataArray.forEach(function (data) {
        var monthYear = data.workout.month_year || '';
        if (monthYear && monthYear !== lastRenderedMonthYear) {
            var label = data.workout.month_year_label || monthYear;
            html += '<div class="month-separator" data-month-key="' + monthYear + '" data-month-year="' + label + '">' + label + '</div>';
            lastRenderedMonthYear = monthYear;
        }
        html += '<div class="workout-item">';
        html += '<div class="workout-header">';
        html += '<h2 class="workout_date_type">' + data.workout.date + ' - ' + data.workout.type_workout;

        if (data.workout.duration > 0) {
            var hours = Math.floor(data.workout.duration / 60);
            var minutes = data.workout.duration % 60;
            var timeStr = hours > 0 ? hours + 'h ' + (minutes > 0 ? minutes + 'min' : '') : minutes + 'min';
            html += ' - ' + timeStr.trim();
        }
        html += '</h2>';

        if (isUserAuthenticated) {
            html += '<div class="workout-actions" style="display: flex; gap: 10px;">';
            html += '<a href="/workout/edit_workout/' + data.workout.id + '/">';
            html += '<button class="cliquable button_workout">' + (translations.edit || 'Edit') + '</button>';
            html += '</a>';
            html += '<button class="cliquable button_workout" onclick="showTemplateModal(' + data.workout.id + ')">Template</button>';
            html += '</div>';
        }
        html += '</div>';

        if (data.exercises && data.exercises.length > 0) {
            var groups = groupExercisesByType(data.exercises);
            groups.forEach(function (group) {
                group.exercises.forEach(function (exercise) {
                    var muscleGroups = exercise.muscle_groups ? exercise.muscle_groups.join(', ') : '';
                    var exerciseId = 'exercise-' + globalExerciseCounter;
                    var positionLabel = exercise.position ? exercise.position + '. ' : '';
                    html += '<div class="exercise-name-section"><strong>' + positionLabel + exercise.name + '</strong><button class="toggle-series-btn" data-exercise-id="' + exerciseId + '">▶</button></div>';
                    html += '<table class="series-table series-collapsed" id="' + exerciseId + '">';

                    if (exercise.exercise_type === 'strength') {
                        html += '<thead><tr><th>' + (translations.series || 'Series') + '</th><th>' + (translations.reps || 'Reps') + '</th><th>' + (translations.weight_kg || 'Weight (kg)') + '</th></tr></thead>';
                    } else {
                        html += '<thead><tr><th>' + (translations.series || 'Series') + '</th><th>' + (translations.duration_s || 'Duration (s)') + '</th><th>' + (translations.distance_m || 'Distance (m)') + '</th></tr></thead>';
                    }
                    html += '<tbody>';

                    if (exercise.series && exercise.series.length > 0) {
                        exercise.series.forEach(function (series) {
                            html += '<tr class="exercise-row" data-muscle-groups="' + muscleGroups + '">';
                            if (exercise.exercise_type === 'strength') {
                                html += '<td>' + series.series_number + '</td><td>' + series.reps + '</td><td>' + series.weight + '</td>';
                            } else {
                                html += '<td>' + series.series_number + '</td><td>' + (series.duration_seconds || '-') + '</td><td>' + (series.distance_m || '-') + '</td>';
                            }
                            html += '</tr>';
                        });
                    }

                    html += '</tbody></table>';
                    globalExerciseCounter++;
                });
            });
        }
        html += '</div>';
    });

    return html;
}

function loadMore() {
    if (isLoading || !hasMoreContent) return;

    isLoading = true;
    $('#loading-indicator').show();
    $('#load-more').hide();

    // Get current filter parameters from the URL
    var workoutType = new URLSearchParams(window.location.search).get('workout_type') || '';
    var exercise = new URLSearchParams(window.location.search).get('exercise') || '';

    var url = "/workout/?page=" + currentPage;
    if (workoutType) {
        url += "&workout_type=" + encodeURIComponent(workoutType);
    }
    if (exercise) {
        url += "&exercise=" + encodeURIComponent(exercise);
    }

    $.ajax({
        url: url,
        type: 'GET',
        dataType: 'json',
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        },
        success: function (response) {
            if (response.workout_data.length > 0) {
                const translations = JSON.parse(document.getElementById('workout-translations').textContent);
                var html = buildWorkoutHTML(response.workout_data, translations);
                var $newItems = $(html);
                $('#workout-list').append($newItems);
                $newItems.filter('.workout-item').each(function () { applyExerciseLimits(this); });
                attachHoverListeners();
                attachToggleListeners();
                updateStickyBanner();
            }

            if (response.has_next) {
                currentPage = response.next_page_number;
                $('#load-more').show();
            } else {
                hasMoreContent = false;
                $('#load-more').remove();
            }

            $('#loading-indicator').hide();
            isLoading = false;
        },
        error: function() {
            $('#loading-indicator').hide();
            $('#load-more').show();
            isLoading = false;
        }
    });
}

function applyFilters(e) {
    if (e) {
        e.preventDefault();
    }

    // Get filter values
    var workoutType = $('#workout-type-filter').val();
    var exercise = $('#exercise-filter').val();

    // Reset pagination
    currentPage = 2;
    hasMoreContent = true;

    // Build URL with filters
    var url = "/workout/?page=1";
    if (workoutType) {
        url += "&workout_type=" + encodeURIComponent(workoutType);
    }
    if (exercise) {
        url += "&exercise=" + encodeURIComponent(exercise);
    }

    // Show loading indicator
    $('#loading-indicator').show();
    $('#load-more').hide();

    $.ajax({
        url: url,
        type: 'GET',
        dataType: 'json',
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        },
        success: function (response) {
            $('#workout-list').empty();
            lastRenderedMonthYear = null;

            if (response.workout_data.length > 0) {
                const translations = JSON.parse(document.getElementById('workout-translations').textContent);
                var html = buildWorkoutHTML(response.workout_data, translations);
                $('#workout-list').html(html);
                document.querySelectorAll('#workout-list .workout-item').forEach(applyExerciseLimits);
                attachHoverListeners();
                attachToggleListeners();
            } else {
                $('#workout-list').html('<p>No workouts recorded.</p>');
            }

            if (response.has_next) {
                currentPage = response.next_page_number;
                hasMoreContent = true;

                // Add or show load more button
                if ($('#load-more').length === 0) {
                    $('#workout-list').after('<button id="load-more" class="cliquable button_workout" data-next-page="' + response.next_page_number + '">Load More</button>');
                    $('#load-more').click(function() {
                        loadMore();
                    });
                } else {
                    $('#load-more').show().attr('data-next-page', response.next_page_number);
                }
            } else {
                hasMoreContent = false;
                $('#load-more').hide();
            }

            updateStickyBanner();
            $('#loading-indicator').hide();
        },
        error: function() {
            $('#loading-indicator').hide();
            $('#workout-list').html('<p>Error loading workouts.</p>');
        }
    });
}

// Schedule filter application after delay
function scheduleFilterApplication() {
    // Clear any existing timer
    if (filterDebounceTimer) {
        clearTimeout(filterDebounceTimer);
    }

    // Set a new timer to apply filters after the delay
    filterDebounceTimer = setTimeout(function() {
        applyFilters();
    }, FILTER_DEBOUNCE_DELAY);
}

// Template management functions
function showTemplateModal(workoutId) {
    const modal = document.getElementById('template-modal');
    modal.style.display = 'block';
    modal.dataset.workoutId = workoutId;
}

function closeTemplateModal() {
    const modal = document.getElementById('template-modal');
    modal.style.display = 'none';
    document.getElementById('template-name-input').value = '';
}

function saveTemplate() {
    const modal = document.getElementById('template-modal');
    const workoutId = modal.dataset.workoutId;
    const templateName = document.getElementById('template-name-input').value.trim();

    if (!templateName) {
        alert('Please enter a template name');
        return;
    }

    fetch(`/workout/create_template/${workoutId}/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify({ template_name: templateName })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            closeTemplateModal();
        } else {
            alert('Error: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Error saving template');
    });
}

function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

function getHeaderHeight() {
    var header = document.getElementById('contenu_header');
    return header ? header.getBoundingClientRect().height : 100;
}

function updateStickyBanner() {
    var banner = document.getElementById('month-sticky-banner');
    if (!banner) return;

    var headerHeight = getHeaderHeight();
    banner.style.top = headerHeight + 'px';

    var seps = document.querySelectorAll('.month-separator');
    if (seps.length === 0) {
        banner.classList.remove('visible');
        return;
    }
    var scrollTop = window.scrollY + headerHeight + 1;
    var currentMonth = null;
    seps.forEach(function(sep) {
        if (sep.getBoundingClientRect().top + window.scrollY <= scrollTop) {
            currentMonth = sep.getAttribute('data-month-year');
        }
    });
    if (currentMonth) {
        banner.textContent = currentMonth;
        banner.classList.add('visible');
    } else {
        banner.classList.remove('visible');
    }
}

$(document).ready(function() {
    // Pre-load SVG content for faster display
    loadSvgContent();

    // Initialize hover listeners for existing exercises
    attachHoverListeners();

    // Initialize toggle listeners for collapsible series
    attachToggleListeners();

    // Handle filter form submission (prevent default since we use auto-apply)
    $('#filter-form').on('submit', function(e) {
        e.preventDefault();
        // Trigger filter application immediately on form submit
        if (filterDebounceTimer) {
            clearTimeout(filterDebounceTimer);
        }
        applyFilters();
    });

    // Handle filter changes - apply filters after delay
    $('#workout-type-filter').on('change', scheduleFilterApplication);
    $('#exercise-filter').on('change', scheduleFilterApplication);

    // Handle clear filters button
    $('#clear-filters').on('click', function(e) {
        e.preventDefault();

        // Reset filter inputs
        $('#workout-type-filter').val('');
        $('#exercise-filter').val('');

        // Apply filters immediately (with empty values, will show all)
        if (filterDebounceTimer) {
            clearTimeout(filterDebounceTimer);
        }
        applyFilters();
    });

    $(window).scroll(function() {
        if ($(window).scrollTop() + $(window).height() >= $(document).height() - 200) {
            loadMore();
        }
    });

    $('#load-more').click(function() {
        loadMore();
    });

    // Re-index all exercises with unique global IDs on initial page load
    var globalIndex = 0;
    var tables = document.querySelectorAll('.series-table');
    var buttons = document.querySelectorAll('.toggle-series-btn');

    // Re-index all tables and buttons with unique global IDs
    tables.forEach(function(table, index) {
        var newId = 'exercise-' + globalIndex;
        table.id = newId;
        globalIndex++;
    });

    // Update all button data-exercise-id attributes to match
    buttons.forEach(function(btn, index) {
        btn.setAttribute('data-exercise-id', 'exercise-' + index);
    });

    // Set the global counter to continue from where we left off
    globalExerciseCounter = globalIndex;

    // Apply exercise limits to initial workout items
    document.querySelectorAll('.workout-item').forEach(applyExerciseLimits);

    // Initialize lastRenderedMonthYear from existing separators (for load-more continuity)
    var separators = document.querySelectorAll('.month-separator');
    if (separators.length > 0) {
        lastRenderedMonthYear = separators[separators.length - 1].getAttribute('data-month-key');
    }

    window.addEventListener('scroll', updateStickyBanner);
    updateStickyBanner();
});
