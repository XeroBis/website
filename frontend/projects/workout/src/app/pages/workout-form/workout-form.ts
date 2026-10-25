import { Component, computed, inject, input, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { EntriesEditor } from '../../ui/entries-editor';
import { WorkoutApi, errorMessage } from '../../workout/api';
import { isoDate } from '../../workout/format';
import { RowError, Row, blankExercise, isRowError, rowsFromEntries, toEntries } from '../../workout/rows';

/** `/workouts/new` and `/workouts/:id/edit`. */
@Component({
  selector: 'ab-workout-form',
  imports: [EntriesEditor, FormsModule, RouterLink, TranslatePipe],
  template: `
    <div class="page-head">
      <h1>{{ (id() ? 'workoutForm.titleEdit' : 'workoutForm.titleNew') | translate }}</h1>
      <a class="btn ghost" routerLink="/workouts">{{ 'common.cancel' | translate }}</a>
    </div>
    @if (notFound()) {
      <p class="error">{{ 'workoutForm.notFound' | translate }}</p>
    } @else if (ready()) {
      <form class="card stack" (ngSubmit)="save()">
        <div class="fields">
          <label
            >{{ 'workoutForm.date' | translate }}
            <input type="date" name="date" required [(ngModel)]="date" />
          </label>
          <label
            >{{ 'workoutForm.duration' | translate }}
            <input type="number" name="duration" min="1" max="1440" required [(ngModel)]="duration" />
          </label>
          @if (!id() && templates.value()?.length) {
            <label
              >{{ 'workoutForm.fromTemplate' | translate }}
              <select #t (change)="useTemplate(+t.value)">
                <option value="">{{ 'common.none' | translate }}</option>
                @for (tpl of templates.value(); track tpl.id) {
                  <option [value]="tpl.id">{{ tpl.name }}</option>
                }
              </select>
            </label>
          }
        </div>
        <h2>{{ 'editor.exercises' | translate }}</h2>
        <ab-entries-editor
          [(rows)]="rows"
          [exercises]="exercises.value() ?? []"
          [savedCircuits]="circuits.value() ?? []"
        >
          <button type="submit" class="btn primary push" [disabled]="saving()">
            {{ (saving() ? 'common.saving' : 'common.save') | translate }}
          </button>
        </ab-entries-editor>
        @if (error(); as e) {
          <p class="error" data-testid="form-error">{{ e.key | translate: e.params }}</p>
        }
      </form>
    } @else {
      <p class="muted">{{ 'common.loading' | translate }}</p>
    }
  `,
})
export class WorkoutForm {
  /** Route param: absent for a new workout. */
  readonly id = input<string>();

  private readonly api = inject(WorkoutApi);
  private readonly router = inject(Router);
  protected readonly exercises = resource({ loader: () => this.api.exercises() });
  protected readonly templates = resource({ loader: () => this.api.templates() });
  protected readonly circuits = resource({ loader: () => this.api.circuits() });

  protected date = isoDate(new Date());
  protected duration = 60;
  protected readonly rows = signal<Row[]>([blankExercise()]);
  protected readonly loaded = signal(false);
  protected readonly notFound = signal(false);
  protected readonly ready = computed(() => !this.id() || this.loaded());
  protected readonly saving = signal(false);
  protected readonly error = signal<RowError | null>(null);

  async ngOnInit(): Promise<void> {
    const id = Number(this.id());
    if (!id) return;
    try {
      const w = await this.api.workout(id);
      this.date = w.date!;
      this.duration = w.duration_minutes!;
      this.rows.set(rowsFromEntries(w.exercises));
      this.loaded.set(true);
    } catch {
      this.notFound.set(true);
    }
  }

  protected useTemplate(id: number): void {
    const template = this.templates.value()?.find((t) => t.id === id);
    this.rows.set(template ? rowsFromEntries(template.exercises) : [blankExercise()]);
  }

  protected async save(): Promise<void> {
    if (!this.date) return this.error.set({ key: 'workoutForm.errDate' });
    if (!(this.duration >= 1 && this.duration <= 1440))
      return this.error.set({ key: 'workoutForm.errDuration' });
    const exercises = toEntries(this.rows());
    if (isRowError(exercises)) return this.error.set(exercises);
    this.error.set(null);
    this.saving.set(true);
    const body = { date: this.date, duration_minutes: this.duration, exercises };
    try {
      const id = Number(this.id());
      if (id) await this.api.updateWorkout(id, body);
      else await this.api.createWorkout(body);
      await this.router.navigateByUrl('/workouts');
    } catch (e) {
      this.error.set({ key: errorMessage(e) });
      this.saving.set(false);
    }
  }
}
