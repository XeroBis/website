import { Component, computed, inject, input } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { LanguageService } from '@shared';

import { setParts } from '../workout/format';
import { SetValues } from '../workout/models';

/** "Set 1  12 reps @ 40 kg · 1min" lines. */
@Component({
  selector: 'ab-set-lines',
  imports: [TranslatePipe],
  template: `
    @for (line of lines(); track $index) {
      <div class="set-line">
        <span class="set-num">{{ 'set.n' | translate: { n: $index + 1 } }}</span>
        <span class="set-values">{{ line }}</span>
      </div>
    }
  `,
})
export class SetLines {
  readonly sets = input.required<SetValues[]>();
  private readonly translate = inject(TranslateService);
  private readonly lang = inject(LanguageService).current;

  protected readonly lines = computed(() => {
    this.lang(); // re-render on language change
    const labels = {
      reps: this.translate.instant('set.reps'),
      difficulty: this.translate.instant('set.difficulty'),
    };
    return this.sets().map((s) => setParts(s, labels).join(' · ') || '—');
  });
}
