import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Entry, Exercise } from '../workout/models';
import { SetLines } from './set-lines';

/** Read-only entries of a workout or template: exercises with their sets, circuits. */
@Component({
  selector: 'ab-entry-list',
  imports: [NgTemplateOutlet, SetLines, TranslatePipe],
  template: `
    @for (entry of entries(); track entry.id) {
      @if (entry.type === 'circuit') {
        <div class="circuit-block" data-type="circuit">
          <div class="circuit-head">
            <span class="badge" data-type="circuit">{{ 'type.circuit' | translate }}</span>
            @if (entry.name) {
              <strong>{{ entry.name }}</strong>
            }
            @if (entry.duration_minutes) {
              <span class="muted">{{ 'workouts.minutes' | translate: { n: entry.duration_minutes } }}</span>
            }
            @if (entry.rounds) {
              <span class="muted">{{ 'workouts.rounds' | translate: { n: entry.rounds } }}</span>
            }
          </div>
          @for (ex of entry.exercises; track ex.id) {
            <ng-container *ngTemplateOutlet="row; context: { $implicit: ex }" />
          }
        </div>
      } @else {
        <ng-container *ngTemplateOutlet="row; context: { $implicit: entry }" />
      }
    }
    <ng-template #row let-ex>
      <div class="exercise-row" [class.highlight]="ex.exercise_id === highlight()">
        <div class="exercise-top">
          <button type="button" class="link" (click)="exerciseClicked.emit(ex.exercise)">{{ ex.exercise.name }}</button>
          <span class="badge" [attr.data-type]="ex.exercise.type">{{ 'type.' + ex.exercise.type | translate }}</span>
        </div>
        <ab-set-lines [sets]="ex.sets" />
      </div>
    </ng-template>
  `,
})
export class EntryList {
  readonly entries = input.required<Entry[]>();
  /** An exercise to highlight (the workouts list's exercise filter). */
  readonly highlight = input<number | null>(null);
  readonly exerciseClicked = output<Exercise>();
}
