import { Component, ElementRef, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon } from '@shared';

/**
 * A "⋯" button opening a list of actions (projected `button.menu-item`s).
 * Closes on a pick, a click elsewhere or Escape.
 */
@Component({
  selector: 'ab-menu',
  imports: [Icon, TranslatePipe],
  host: {
    class: 'menu',
    '(document:click)': 'closeOutside($event)',
    '(keydown.escape)': 'open.set(false)',
  },
  template: `
    <button
      type="button"
      class="icon-btn"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="'common.more' | translate"
      (click)="open.set(!open())"
    >
      <ab-icon name="more" />
    </button>
    @if (open()) {
      <div class="menu-list" role="menu" (click)="open.set(false)">
        <ng-content />
      </div>
    }
  `,
})
export class Menu {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly open = signal(false);

  protected closeOutside(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}
