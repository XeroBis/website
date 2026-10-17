import { Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon, IconName } from '@shared';

import { MediaApi, errorMessage } from '../media/media-api';
import { EntryDetail, EntrySummary, QuickAction } from '../media/models';

/**
 * One-tap progress from a card: Start, then Finish (books, films) or
 * +1 episode (series, offering Finish after the last known episode).
 */
@Component({
  selector: 'ab-quick-actions',
  imports: [Icon, TranslatePipe],
  template: `
    @if (action(); as a) {
      <button
        type="button"
        class="btn small"
        [class.soft]="soft()"
        [disabled]="busy()"
        (click)="run(a.action, $event)"
      >
        @if (a.icon) {
          <ab-icon [name]="a.icon" />
        }
        {{ a.label | translate }}
      </button>
    }
    @if (error()) {
      <span class="error" role="alert">{{ error()! | translate }}</span>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .error {
      font-size: 12px;
    }
  `,
})
export class QuickActions {
  private readonly api = inject(MediaApi);

  readonly entry = input.required<EntrySummary>();
  readonly soft = input(false);
  readonly changed = output<EntryDetail>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly action = computed(
    (): { action: QuickAction; label: string; icon?: IconName } | null => {
      const e = this.entry();
      const book = e.item.type === 'book';
      switch (e.status) {
        case 'want':
          return {
            action: 'start',
            label: book ? 'action.startReading' : 'action.start',
            icon: 'play',
          };
        case 'dropped':
          return { action: 'start', label: 'action.resume', icon: 'play' };
        case 'in_progress':
          if (e.item.type === 'series' && !e.at_last_known_episode) {
            return { action: 'next-episode', label: 'action.nextEpisode' };
          }
          return { action: 'finish', label: 'action.finish', icon: 'check' };
        case 'done':
          return null;
      }
    },
  );

  protected async run(action: QuickAction, event: Event): Promise<void> {
    // Cards are links: don't navigate when tapping the button.
    event.preventDefault();
    event.stopPropagation();
    this.busy.set(true);
    this.error.set(null);
    try {
      this.changed.emit(await this.api.act(this.entry().id, action));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
