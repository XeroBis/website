import { Component, inject, input, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { MuscleMap } from '../../ui/muscle-map';
import { WorkoutApi, errorMessage } from '../../workout/api';
import { ExerciseType, MuscleIntensity } from '../../workout/models';

/** `/exercises/new` (any workout user) and `/exercises/:id` (admins). */
@Component({
  selector: 'ab-exercise-form',
  imports: [FormsModule, MuscleMap, RouterLink, TranslatePipe],
  template: `
    <div class="page-head">
      <h1>{{ (isNew() ? 'exercises.titleNew' : 'exercises.titleEdit') | translate }}</h1>
      <a class="btn ghost" routerLink="/exercises">{{ 'common.cancel' | translate }}</a>
    </div>
    @if (state() === 'missing') {
      <p class="error">{{ 'exercises.notFound' | translate }}</p>
    } @else if (state() === 'ready') {
      <form class="card stack" (ngSubmit)="save()">
        <div class="fields">
          <label
            >{{ 'exercises.name' | translate }}
            <input type="text" name="name" maxlength="100" required [(ngModel)]="name" />
          </label>
          <label
            >{{ 'exercises.type' | translate }}
            <select name="type" [(ngModel)]="type">
              <option value="strength">{{ 'type.strength' | translate }}</option>
              <option value="cardio">{{ 'type.cardio' | translate }}</option>
            </select>
          </label>
        </div>
        <h2>{{ 'exercises.muscles' | translate }}</h2>
        <ab-muscle-map mode="edit" [(muscles)]="muscles" />
        <h2>{{ 'exercises.equipments' | translate }}</h2>
        <div class="checks">
          @for (eq of equipments.value(); track eq.id) {
            <label class="check-label">
              <input type="checkbox" [checked]="chosen().has(eq.name)" (change)="toggle(eq.name)" />
              {{ eq.name }}
            </label>
          } @empty {
            <span class="muted">{{ 'equipments.empty' | translate }}</span>
          }
        </div>
        @if (error(); as e) {
          <p class="error" data-testid="form-error">{{ e | translate }}</p>
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
export class ExerciseForm {
  readonly id = input.required<string>();

  private readonly api = inject(WorkoutApi);
  private readonly router = inject(Router);
  protected readonly equipments = resource({ loader: () => this.api.equipments() });
  protected name = '';
  protected type: ExerciseType = 'strength';
  protected readonly muscles = signal<MuscleIntensity[]>([]);
  protected readonly chosen = signal(new Set<string>());
  protected readonly state = signal<'loading' | 'ready' | 'missing'>('loading');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected isNew(): boolean {
    return this.id() === 'new';
  }

  async ngOnInit(): Promise<void> {
    if (this.isNew()) return this.state.set('ready');
    try {
      const ex = await this.api.exercise(Number(this.id()));
      this.name = ex.name;
      this.type = ex.type;
      this.muscles.set(ex.muscles);
      this.chosen.set(new Set(ex.equipments.map((e) => e.name)));
      this.state.set('ready');
    } catch {
      this.state.set('missing');
    }
  }

  protected toggle(name: string): void {
    const next = new Set(this.chosen());
    if (!next.delete(name)) next.add(name);
    this.chosen.set(next);
  }

  protected async save(): Promise<void> {
    if (!this.name.trim()) return this.error.set('exercises.errName');
    this.error.set(null);
    this.saving.set(true);
    const body = {
      name: this.name.trim(),
      type: this.type,
      muscles: this.muscles(),
      equipments: [...this.chosen()],
    };
    try {
      if (this.isNew()) await this.api.createExercise(body);
      else await this.api.updateExercise(Number(this.id()), body);
      await this.router.navigateByUrl('/exercises');
    } catch (e) {
      this.error.set(errorMessage(e));
      this.saving.set(false);
    }
  }
}
