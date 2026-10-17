import { Component, inject, input, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { EntriesEditor } from '../../ui/entries-editor';
import { WorkoutApi, errorMessage } from '../../workout/api';
import { ExerciseRow, Row, RowError, blankExercise, isRowError, rowsFromSavedCircuit, toMembers } from '../../workout/rows';

/** `/circuits/new` and `/circuits/:id`: name, duration, rounds, exercises. */
@Component({
  selector: 'ab-circuit-form',
  imports: [EntriesEditor, FormsModule, RouterLink, TranslatePipe],
  template: `
    <div class="page-head">
      <h1>{{ (isNew() ? 'circuits.titleNew' : 'circuits.titleEdit') | translate }}</h1>
      <a class="btn ghost" routerLink="/circuits">{{ 'common.cancel' | translate }}</a>
    </div>
    @if (state() === 'missing') {
      <p class="error">{{ 'circuits.notFound' | translate }}</p>
    } @else if (state() === 'ready') {
      <form class="card stack" (ngSubmit)="save()">
        <div class="fields">
          <label
            >{{ 'circuits.name' | translate }}
            <input type="text" name="name" maxlength="100" required [(ngModel)]="name" />
          </label>
          <label
            >{{ 'editor.circuitDuration' | translate }}
            <input type="number" name="duration" min="1" max="1440" [(ngModel)]="duration" />
          </label>
          <label
            >{{ 'editor.circuitRounds' | translate }}
            <input type="number" name="rounds" min="1" max="1000" [(ngModel)]="rounds" />
          </label>
        </div>
        <h2>{{ 'editor.exercises' | translate }}</h2>
        <ab-entries-editor [(rows)]="rows" [exercises]="exercises.value() ?? []" [circuits]="false" />
        @if (error(); as e) {
          <p class="error" data-testid="form-error">{{ e.key | translate: e.params }}</p>
        }
        <button type="submit" class="btn primary" [disabled]="saving()">
          {{ (saving() ? 'common.saving' : 'common.save') | translate }}
        </button>
      </form>
    } @else {
      <p class="muted">{{ 'common.loading' | translate }}</p>
    }
  `,
})
export class CircuitForm {
  readonly id = input.required<string>();

  private readonly api = inject(WorkoutApi);
  private readonly router = inject(Router);
  protected readonly exercises = resource({ loader: () => this.api.exercises() });
  protected name = '';
  protected duration: number | null = null;
  protected rounds: number | null = null;
  protected readonly rows = signal<Row[]>([blankExercise()]);
  protected readonly state = signal<'loading' | 'ready' | 'missing'>('loading');
  protected readonly saving = signal(false);
  protected readonly error = signal<RowError | null>(null);

  protected isNew(): boolean {
    return this.id() === 'new';
  }

  async ngOnInit(): Promise<void> {
    if (this.isNew()) return this.state.set('ready');
    try {
      const c = await this.api.circuit(Number(this.id()));
      this.name = c.name;
      this.duration = c.duration_minutes;
      this.rounds = c.rounds;
      this.rows.set(rowsFromSavedCircuit(c));
      this.state.set('ready');
    } catch {
      this.state.set('missing');
    }
  }

  protected async save(): Promise<void> {
    if (!this.name.trim()) return this.error.set({ key: 'circuits.errName' });
    const exercises = toMembers(this.rows() as ExerciseRow[]);
    if (isRowError(exercises)) return this.error.set(exercises);
    this.error.set(null);
    this.saving.set(true);
    const body = {
      name: this.name.trim(),
      duration_minutes: this.duration || null,
      rounds: this.rounds || null,
      exercises,
    };
    try {
      if (this.isNew()) await this.api.createCircuit(body);
      else await this.api.updateCircuit(Number(this.id()), body);
      await this.router.navigateByUrl('/circuits');
    } catch (e) {
      this.error.set({ key: errorMessage(e) });
      this.saving.set(false);
    }
  }
}
