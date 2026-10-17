import { DatePipe } from '@angular/common';
import { Component, inject, input, output, resource } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { LanguageService } from '@shared';

import { WorkoutApi } from '../workout/api';
import { flatExercises } from '../workout/format';
import { Exercise } from '../workout/models';
import { Modal } from './modal';
import { SetLines } from './set-lines';

/** Every logged set of one exercise, newest workout first (for the viewed user). */
@Component({
  selector: 'ab-history-modal',
  imports: [DatePipe, Modal, SetLines, TranslatePipe],
  template: `
    <ab-modal [heading]="exercise().name" (closed)="closed.emit()">
      @if (history.isLoading()) {
        <p class="muted">{{ 'common.loading' | translate }}</p>
      } @else if (history.error()) {
        <p class="error">{{ 'errors.generic' | translate }}</p>
      } @else {
        @for (row of history.value(); track row.id) {
          <div class="history-row" data-testid="history-row">
            <div class="history-date">{{ row.date | date: 'mediumDate' : undefined : lang() }}</div>
            @for (sets of row.sets; track $index) {
              <ab-set-lines [sets]="sets" />
            }
          </div>
        } @empty {
          <p class="muted">{{ 'history.empty' | translate }}</p>
        }
      }
    </ab-modal>
  `,
})
export class HistoryModal {
  readonly exercise = input.required<Exercise>();
  /** Whose history: null for yourself. */
  readonly userId = input<number | null>(null);
  readonly closed = output<void>();

  private readonly api = inject(WorkoutApi);
  protected readonly lang = inject(LanguageService).current;

  protected readonly history = resource({
    params: () => ({ exercise: this.exercise().id, user: this.userId() }),
    loader: async ({ params }) => {
      const workouts = await this.api.workouts({
        exercise_id: params.exercise,
        user_id: params.user,
        limit: 100,
      });
      return workouts.map((w) => ({
        id: w.id,
        date: w.date,
        sets: flatExercises(w.exercises)
          .filter((e) => e.exercise_id === params.exercise)
          .map((e) => e.sets),
      }));
    },
  });
}
