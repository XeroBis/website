import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon } from '@shared';

import { PdfSource } from '../pdf/sources';
import { PluralPipe } from './plural';

/** The open file of a one-PDF tool: name, page count and "Change file". */
@Component({
  selector: 'ab-file-head',
  imports: [Icon, PluralPipe, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="file-head">
      <ab-icon name="file" class="file-icon" />
      <span class="chip-name">{{ source().name }}</span>
      <span class="muted">{{
        'common.page' | plural: source().pages | translate: { count: source().pages }
      }}</span>
      <label class="btn-small">
        {{ 'common.changeFile' | translate }}
        <input
          class="visually-hidden"
          type="file"
          accept="application/pdf,.pdf"
          (change)="pick($event)"
        />
      </label>
    </div>
  `,
})
export class FileHead {
  readonly source = input.required<PdfSource>();
  readonly picked = output<File[]>();

  protected pick(event: Event): void {
    const field = event.target as HTMLInputElement;
    const files = [...(field.files ?? [])];
    field.value = '';
    if (files.length) this.picked.emit(files);
  }
}
