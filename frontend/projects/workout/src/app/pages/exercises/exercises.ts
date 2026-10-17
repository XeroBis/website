import { Component, computed, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthService, Icon } from '@shared';

import { ConfirmButton } from '../../ui/confirm-button';
import { HistoryModal } from '../../ui/history-modal';
import { Modal } from '../../ui/modal';
import { MuscleMap } from '../../ui/muscle-map';
import { WorkoutApi, errorMessage } from '../../workout/api';
import { matchesExercise } from '../../workout/format';
import { Exercise, ExerciseType, MuscleIntensity } from '../../workout/models';

/** The shared catalog, filtered in the browser. */
@Component({
  selector: 'ab-exercises',
  imports: [ConfirmButton, HistoryModal, Icon, Modal, MuscleMap, RouterLink, TranslatePipe],
  template: `
    <div class="toolbar">
      <input
        type="search"
        data-testid="search"
        [placeholder]="'exercises.search' | translate"
        [attr.aria-label]="'exercises.search' | translate"
        [value]="q()"
        (input)="q.set($any($event.target).value)"
      />
      <select [attr.aria-label]="'exercises.type' | translate" (change)="type.set($any($event.target).value)">
        <option value="">{{ 'exercises.allTypes' | translate }}</option>
        <option value="strength">{{ 'type.strength' | translate }}</option>
        <option value="cardio">{{ 'type.cardio' | translate }}</option>
      </select>
      <button type="button" class="btn ghost" [class.active]="showMap() || muscles().length" (click)="showMap.set(!showMap())">
        {{ 'exercises.muscleFilter' | translate }}
        @if (muscles().length) {
          <span class="count">{{ muscles().length }}</span>
        }
      </button>
      <a class="btn primary push" routerLink="/exercises/new"><ab-icon name="plus" /> {{ 'exercises.new' | translate }}</a>
    </div>
    @if (showMap()) {
      <section class="card">
        <ab-muscle-map mode="toggle" [(muscles)]="muscles" [list]="true" />
      </section>
    }
    @if (error(); as e) {
      <p class="error" data-testid="error">{{ e | translate }}</p>
    }
    <table class="table card">
      <tbody>
        @for (ex of filtered(); track ex.id) {
          <tr data-testid="exercise">
            <td>
              <button type="button" class="link" (click)="history.set(ex)">{{ ex.name }}</button>
            </td>
            <td><span class="badge" [attr.data-type]="ex.type">{{ 'type.' + ex.type | translate }}</span></td>
            <td class="actions">
              <button type="button" class="btn ghost sm" (click)="details.set(ex)"><ab-icon name="info" /> {{ 'common.details' | translate }}</button>
              @if (auth.isAdmin()) {
                <a class="btn ghost sm" [routerLink]="['/exercises', ex.id]"><ab-icon name="pencil" /> {{ 'common.edit' | translate }}</a>
                <ab-confirm-button label="common.delete" (confirmed)="remove(ex)" />
              }
            </td>
          </tr>
        } @empty {
          @if (exercises.hasValue()) {
            <tr>
              <td class="empty">{{ (filtering() ? 'exercises.emptyFilter' : 'exercises.empty') | translate }}</td>
            </tr>
          }
        }
      </tbody>
    </table>
    @if (details(); as ex) {
      <ab-modal [heading]="ex.name" (closed)="details.set(null)">
        <ab-muscle-map [muscles]="ex.muscles" [list]="true" />
        <h3>{{ 'details.equipments' | translate }}</h3>
        <p>
          @for (eq of ex.equipments; track eq.id; let last = $last) {
            {{ eq.name }}{{ last ? '' : ', ' }}
          } @empty {
            —
          }
        </p>
      </ab-modal>
    }
    @if (history(); as ex) {
      <ab-history-modal [exercise]="ex" (closed)="history.set(null)" />
    }
  `,
})
export class Exercises {
  private readonly api = inject(WorkoutApi);
  protected readonly auth = inject(AuthService);
  protected readonly exercises = resource({ loader: () => this.api.exercises() });
  protected readonly q = signal('');
  protected readonly type = signal<ExerciseType | ''>('');
  protected readonly muscles = signal<MuscleIntensity[]>([]);
  protected readonly showMap = signal(false);
  protected readonly details = signal<Exercise | null>(null);
  protected readonly history = signal<Exercise | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly filtering = computed(() => !!(this.q().trim() || this.type() || this.muscles().length));
  protected readonly filtered = computed(() =>
    (this.exercises.value() ?? []).filter(
      (ex) =>
        matchesExercise(ex, this.q()) &&
        (!this.type() || ex.type === this.type()) &&
        this.muscles().every((m) => ex.muscles.some((em) => em.name === m.name)),
    ),
  );

  protected async remove(ex: Exercise): Promise<void> {
    try {
      await this.api.deleteExercise(ex.id);
      this.error.set(null);
      this.exercises.reload();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
