import { Component, inject, input, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { Icon } from '@shared';

import { errorMessage } from '../workout/api';
import { FileShape, checkFile, downloadJson, readJson } from '../workout/files';
import { ImportResult } from '../workout/models';
import { ConfirmButton } from './confirm-button';

/**
 * One import/export block: Export downloads `filename`; Import reads a file,
 * checks its shape, sends it with `send` and shows the result. Optional
 * Delete all (confirmed).
 */
@Component({
  selector: 'ab-transfer-section',
  imports: [ConfirmButton, Icon, TranslatePipe],
  template: `
    <section class="card transfer" [attr.data-testid]="'transfer-' + filename()">
      <h2>{{ heading() | translate }}</h2>
      <ng-content />
      <div class="actions">
        <button type="button" class="btn ghost" [disabled]="disabled()" (click)="exportFile()">
          <ab-icon name="download" /> {{ 'transfer.export' | translate }}
        </button>
        <label class="btn ghost" [class.disabled]="busy()">
          <ab-icon name="upload" />
          {{ (busy() ? 'transfer.importing' : 'transfer.import') | translate }}
          <input type="file" accept=".json,application/json" hidden [disabled]="busy()" (change)="importFile($event)" />
        </label>
        @if (canDeleteAll()) {
          <ab-confirm-button label="transfer.deleteAll" [disabled]="disabled()" (confirmed)="deleteAll.emit()" />
        }
      </div>
      @if (result(); as r) {
        <p class="success" data-testid="result">{{ 'transfer.result' | translate: r }}</p>
        @if (r.ignored.length) {
          <div class="warning">
            {{ 'transfer.skippedLabel' | translate }}
            <ul>
              @for (line of r.ignored; track $index) {
                <li>{{ line }}</li>
              }
            </ul>
          </div>
        }
      }
      @if (error(); as e) {
        <p class="error" data-testid="error">{{ e }}</p>
      }
    </section>
  `,
})
export class TransferSection {
  readonly heading = input.required<string>();
  readonly filename = input.required<string>();
  readonly shape = input.required<FileShape>();
  readonly fetch = input.required<() => Promise<unknown>>();
  readonly send = input.required<(data: unknown) => Promise<ImportResult>>();
  readonly canDeleteAll = input(false);
  readonly disabled = input(false);
  readonly deleteAll = output<void>();

  private readonly translate = inject(TranslateService);
  protected readonly busy = signal(false);
  protected readonly result = signal<ImportResult | null>(null);
  protected readonly error = signal<string | null>(null);

  protected async exportFile(): Promise<void> {
    this.error.set(null);
    try {
      downloadJson(await this.fetch()(), this.filename());
    } catch (e) {
      this.error.set(this.translate.instant(errorMessage(e)));
    }
  }

  protected async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.result.set(null);
    this.error.set(null);
    let data: unknown;
    try {
      data = await readJson(file);
    } catch {
      this.error.set(this.translate.instant('transfer.invalid'));
      return;
    }
    const problem = checkFile(data, this.shape());
    if (problem) {
      this.error.set(this.translate.instant('transfer.invalidAt', { error: problem }));
      return;
    }
    this.busy.set(true);
    try {
      this.result.set(await this.send()(data));
    } catch (e) {
      this.error.set(this.translate.instant(errorMessage(e)));
    } finally {
      this.busy.set(false);
    }
  }
}
