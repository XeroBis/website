import { Component, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon } from '@shared';

import { ConfirmButton } from '../../ui/confirm-button';
import { EntryList } from '../../ui/entry-list';
import { WorkoutApi, errorMessage } from '../../workout/api';
import { SavedCircuit } from '../../workout/models';

/** Your saved circuits (private). */
@Component({
  selector: 'ab-circuits',
  imports: [ConfirmButton, EntryList, Icon, RouterLink, TranslatePipe],
  template: `
    <div class="toolbar">
      <a class="btn primary push" routerLink="/circuits/new"><ab-icon name="plus" /> {{ 'circuits.new' | translate }}</a>
    </div>
    @if (error(); as e) {
      <p class="error">{{ e | translate }}</p>
    }
    @for (c of circuits.value(); track c.id) {
      <article class="card workout-card" data-testid="circuit">
        <header class="workout-head">
          <span class="workout-date">{{ c.name }}</span>
          @if (c.duration_minutes) {
            <span class="workout-duration">{{ 'workouts.minutes' | translate: { n: c.duration_minutes } }}</span>
          }
          @if (c.rounds) {
            <span class="workout-duration">{{ 'workouts.rounds' | translate: { n: c.rounds } }}</span>
          }
          <span class="push"></span>
          <a class="btn ghost sm" [routerLink]="['/circuits', c.id]"><ab-icon name="pencil" /> {{ 'common.edit' | translate }}</a>
          <ab-confirm-button label="common.delete" (confirmed)="remove(c)" />
        </header>
        <ab-entry-list [entries]="c.exercises" />
      </article>
    } @empty {
      @if (circuits.hasValue()) {
        <p class="empty">{{ 'circuits.empty' | translate }}</p>
      }
    }
  `,
})
export class Circuits {
  private readonly api = inject(WorkoutApi);
  protected readonly circuits = resource({ loader: () => this.api.circuits() });
  protected readonly error = signal<string | null>(null);

  protected async remove(c: SavedCircuit): Promise<void> {
    try {
      await this.api.deleteCircuit(c.id);
      this.circuits.reload();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
