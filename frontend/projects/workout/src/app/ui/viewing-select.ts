import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Viewing } from '../workout/viewing';

/** "Viewing: [Alice ▾]" — whose data the page shows (needs `Viewing` provided). */
@Component({
  selector: 'ab-viewing-select',
  imports: [TranslatePipe],
  template: `
    @if (viewing.users().length > 1) {
      <label class="toolbar-field">
        <span>{{ 'viewing.label' | translate }}</span>
        <select
          data-testid="viewing"
          [value]="viewing.userId()"
          (change)="viewing.select(+$any($event.target).value)"
        >
          @for (u of viewing.users(); track u.id) {
            <option [value]="u.id" [selected]="u.id === viewing.userId()">{{ u.pseudo }}</option>
          }
        </select>
      </label>
    }
  `,
})
export class ViewingSelect {
  protected readonly viewing = inject(Viewing);
}
