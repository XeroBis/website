import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon } from '@shared';

import { Skipped } from '../pdf/sources';

/** "Add PDFs": a label styled as a button around a visually hidden file input. */
@Component({
  selector: 'ab-file-button',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="btn-add" [class.primary]="primary()">
      <ab-icon name="plus" />
      {{ label() }}
      <input
        class="visually-hidden"
        type="file"
        [accept]="accept()"
        [multiple]="multiple()"
        (change)="pick($event)"
      />
    </label>
  `,
})
export class FileButton {
  readonly label = input.required<string>();
  readonly accept = input.required<string>();
  readonly multiple = input(false);
  /** The filled look, for the empty state's button. */
  readonly primary = input(false);
  readonly picked = output<File[]>();

  protected pick(event: Event): void {
    const field = event.target as HTMLInputElement;
    const files = [...(field.files ?? [])];
    field.value = ''; // so picking the same file again fires again
    if (files.length) this.picked.emit(files);
  }
}

/** Files dropped from the desktop anywhere on the host. Adds `.dropping` while over it. */
@Directive({
  selector: '[abFileDrop]',
  host: {
    '[class.dropping]': 'over()',
    '(dragover)': 'enter($event)',
    '(dragleave)': 'leave($event)',
    '(drop)': 'drop($event)',
  },
})
export class FileDrop {
  readonly abFileDrop = output<File[]>();
  protected readonly over = signal(false);

  private hasFiles(event: DragEvent): boolean {
    return !!event.dataTransfer && [...event.dataTransfer.types].includes('Files');
  }

  protected enter(event: DragEvent): void {
    if (!this.hasFiles(event)) return;
    event.preventDefault();
    this.over.set(true);
  }

  protected leave(event: DragEvent): void {
    const to = event.relatedTarget as Node | null;
    if (!to || !(event.currentTarget as Node).contains(to)) this.over.set(false);
  }

  protected drop(event: DragEvent): void {
    if (!this.hasFiles(event)) return;
    event.preventDefault();
    this.over.set(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length) this.abFileDrop.emit(files);
  }
}

/** What a tool couldn't use from the last files added. */
@Component({
  selector: 'ab-skipped',
  imports: [Icon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (skipped().length || error()) {
      <div class="notice" role="alert">
        <ab-icon name="info" />
        <div>
          @for (s of skipped(); track $index) {
            <p>{{ 'error.' + s.reason | translate: { name: s.name } }}</p>
          }
          @if (error()) {
            <p>{{ 'error.' + error() | translate }}</p>
          }
        </div>
      </div>
    }
  `,
})
export class SkippedNotice {
  readonly skipped = input<Skipped[]>([]);
  /** A tool-level error key under `error.` (e.g. `failed`). */
  readonly error = input<string | null>(null);
}
