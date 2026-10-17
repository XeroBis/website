import { Component, computed, input, linkedSignal, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { aggregateEquipments, aggregateMuscles, flatExercises } from '../workout/format';
import { Entry } from '../workout/models';
import { Modal } from './modal';
import { MuscleMap } from './muscle-map';

/** Muscles and equipment of a workout's or template's exercises (untick some to narrow). */
@Component({
  selector: 'ab-details-modal',
  imports: [Modal, MuscleMap, TranslatePipe],
  template: `
    <ab-modal [heading]="heading()" [wide]="true" (closed)="closed.emit()">
      <div class="details">
        <ul class="check-list">
          @for (ex of exercises(); track ex.id) {
            <li>
              <label>
                <input type="checkbox" [checked]="selected().has(ex.id)" (change)="toggle(ex.id)" />
                {{ ex.exercise.name }}
              </label>
            </li>
          }
        </ul>
        <ab-muscle-map [muscles]="muscles()" />
        <div>
          <h3>{{ 'details.muscles' | translate }}</h3>
          <ul class="plain">
            @for (m of muscles(); track m.name) {
              <li class="muscle-line" [attr.data-intensity]="m.intensity">
                {{ 'muscle.' + m.name | translate }}
                <span class="dots">
                  @for (i of [1, 2, 3]; track i) {
                    <span class="dot" [class.on]="i <= m.intensity"></span>
                  }
                </span>
              </li>
            } @empty {
              <li class="muted">—</li>
            }
          </ul>
          <h3>{{ 'details.equipments' | translate }}</h3>
          <ul class="plain">
            @for (eq of equipments(); track eq.id) {
              <li>{{ eq.name }}</li>
            } @empty {
              <li class="muted">—</li>
            }
          </ul>
        </div>
      </div>
    </ab-modal>
  `,
})
export class DetailsModal {
  readonly heading = input.required<string>();
  readonly entries = input.required<Entry[]>();
  readonly closed = output<void>();

  protected readonly exercises = computed(() => flatExercises(this.entries()));
  protected readonly selected = linkedSignal(() => new Set(this.exercises().map((e) => e.id)));
  private readonly chosen = computed(() => this.exercises().filter((e) => this.selected().has(e.id)));
  protected readonly muscles = computed(() => aggregateMuscles(this.chosen()));
  protected readonly equipments = computed(() => aggregateEquipments(this.chosen()));

  protected toggle(id: number): void {
    const next = new Set(this.selected());
    if (!next.delete(id)) next.add(id);
    this.selected.set(next);
  }
}
