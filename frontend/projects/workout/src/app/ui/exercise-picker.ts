import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { matchesExercise } from '../workout/format';
import { Exercise } from '../workout/models';

/** Type-ahead over the catalog (names and muscles, every word must match). */
@Component({
  selector: 'ab-exercise-picker',
  imports: [TranslatePipe],
  template: `
    <div class="picker">
      <input
        type="text"
        autocomplete="off"
        [value]="text()"
        [placeholder]="'editor.search' | translate"
        [attr.aria-label]="'editor.exercise' | translate"
        (input)="text.set($any($event.target).value); open.set(true)"
        (focus)="open.set(true)"
        (blur)="close()"
        (keydown.escape)="open.set(false)"
        (keydown.enter)="$event.preventDefault(); matches()[0] && pick(matches()[0])"
      />
      @if (open() && matches().length) {
        <ul class="picker-list" role="listbox">
          @for (ex of matches(); track ex.id) {
            <li role="option" [attr.aria-selected]="ex.id === value()?.id" (mousedown)="pick(ex)">
              {{ ex.name }} <span class="badge" [attr.data-type]="ex.type">{{ 'type.' + ex.type | translate }}</span>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class ExercisePicker {
  readonly exercises = input.required<Exercise[]>();
  readonly value = input<Exercise | null>(null);
  readonly picked = output<Exercise>();

  protected readonly text = linkedSignal(() => this.value()?.name ?? '');
  protected readonly open = signal(false);
  protected readonly matches = computed(() => {
    const q = this.text();
    // Showing the chosen one's name: list everything again.
    if (this.value() && q === this.value()!.name) return this.exercises();
    return this.exercises().filter((e) => matchesExercise(e, q));
  });

  protected pick(ex: Exercise): void {
    this.text.set(ex.name);
    this.open.set(false);
    this.picked.emit(ex);
  }

  protected close(): void {
    // After a click on the list (mousedown fires first).
    setTimeout(() => this.open.set(false), 150);
  }
}
