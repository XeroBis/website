import { Component, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** A button asking "Sure? Yes / No" before emitting `confirmed`. */
@Component({
  selector: 'ab-confirm-button',
  imports: [TranslatePipe],
  template: `
    @if (asking()) {
      <span class="confirm">
        <span class="confirm-label">{{ question() | translate }}</span>
        <button type="button" class="btn danger sm" (click)="asking.set(false); confirmed.emit()">
          {{ 'common.yes' | translate }}
        </button>
        <button type="button" class="btn ghost sm" (click)="asking.set(false)">
          {{ 'common.no' | translate }}
        </button>
      </span>
    } @else {
      <button type="button" class="btn sm" [class]="tone()" [disabled]="disabled()" (click)="asking.set(true)">
        {{ label() | translate }}
      </button>
    }
  `,
})
export class ConfirmButton {
  /** Translation keys. */
  readonly label = input.required<string>();
  readonly question = input('common.sure');
  readonly tone = input<'danger' | 'primary' | 'ghost'>('danger');
  readonly disabled = input(false);
  readonly confirmed = output<void>();
  protected readonly asking = signal(false);
}
