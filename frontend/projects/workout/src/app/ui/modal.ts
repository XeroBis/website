import { Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon } from '@shared';

/** A centred dialog over a dimmed page; closes on the ✕, the backdrop or Escape. */
@Component({
  selector: 'ab-modal',
  imports: [Icon, TranslatePipe],
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="modal-backdrop" (click)="closed.emit()">
      <div
        class="modal"
        [class.wide]="wide()"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="heading()"
        (click)="$event.stopPropagation()"
      >
        <header class="modal-head">
          <h2>{{ heading() }}</h2>
          <button type="button" class="icon-btn" [attr.aria-label]="'common.close' | translate" (click)="closed.emit()">
            <ab-icon name="x" />
          </button>
        </header>
        <ng-content />
      </div>
    </div>
  `,
})
export class Modal {
  readonly heading = input.required<string>();
  readonly wide = input(false);
  readonly closed = output<void>();
}
