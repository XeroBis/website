import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { HttpEventType } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { Icon } from '@shared';
import { CardSet, CatalogStats, RefreshStepStatus } from '../../models/card.model';
import { CatalogService, ImageArchiveSelection } from '../../services/catalog.service';
import { httpErrorMessage as errorMessage } from '@shared';
import { readJson } from '@shared';

export const REFRESH_STEPS = [
  'import_html',
  'import_card_details',
  'scrape_images',
  'generate_thumbnails',
  'scrape_logos_symbols',
  'download_variant_icons',
] as const;

@Component({
  selector: 'app-catalog-management',
  imports: [Icon, DatePipe, NgTemplateOutlet, FormsModule, TranslatePipe],
  template: `
    <h1>{{ 'nav.catalogManagement' | translate }}</h1>
    @if (stats(); as s) {
      <p class="stats">
        <span
          ><strong>{{ s.total_cards }}</strong> {{ 'admin.statCards' | translate }}</span
        >
        <span
          ><strong>{{ s.total_sets }}</strong> {{ 'admin.statSets' | translate }}</span
        >
        <span
          ><strong>{{ s.distinct_card_names }}</strong> {{ 'admin.statNames' | translate }}</span
        >
      </p>
    }
    @if (error()) {
      <p class="notice notice-error" role="alert"><ab-icon name="info" /> {{ error() }}</p>
    }
    @if (message()) {
      <p class="notice notice-success" role="status"><ab-icon name="check" /> {{ message() }}</p>
    }
    <section class="surface admin-section">
      <header class="section-head">
        <h2>{{ 'admin.refresh' | translate }}</h2>
        @if (statuses()['full']; as status) {
          <span [class]="badgeClass(status)">{{
            'admin.status.' + status.status | translate
          }}</span>
        }
        <button class="btn btn-primary" [disabled]="busy()" (click)="start('full')">
          <ab-icon name="play" /> {{ 'admin.steps.full' | translate }}
        </button>
      </header>
      @if (statuses()['full']; as status) {
        @if (
          status.status === 'running' ||
          status.error ||
          status.last_run_at ||
          resultEntries(status).length
        ) {
          <div class="row">
            <ng-container
              *ngTemplateOutlet="jobBody; context: { $implicit: status, steps: 'admin.steps.' }"
            />
          </div>
        }
      }
      @for (key of steps; track key) {
        <div class="row">
          <div class="row-main">
            <span class="row-title">
              {{ 'admin.steps.' + key | translate }}
              @if (statuses()[key]; as status) {
                <span [class]="badgeClass(status)">{{
                  'admin.status.' + status.status | translate
                }}</span>
              }
            </span>
            <button class="btn btn-sm btn-secondary" [disabled]="busy()" (click)="start(key)">
              <ab-icon name="play" /> {{ 'admin.run' | translate }}
            </button>
          </div>
          @if (statuses()[key]; as status) {
            <ng-container
              *ngTemplateOutlet="jobBody; context: { $implicit: status, steps: 'admin.steps.' }"
            />
          }
        </div>
      }
    </section>
    <section class="surface admin-section">
      <header class="section-head">
        <h2>{{ 'admin.metadata' | translate }}</h2>
        <div class="actions">
          <a
            class="btn btn-secondary"
            href="/api/cards/catalog/export"
            download="cards_metadata.json"
            ><ab-icon name="download" /> {{ 'common.export' | translate }}</a
          >
          <label class="btn btn-secondary" [class.btn-disabled]="busy()"
            ><ab-icon name="upload" /> {{ 'common.import' | translate
            }}<input
              type="file"
              accept=".json,application/json"
              [disabled]="busy()"
              (change)="importMetadata($event)"
              hidden
          /></label>
        </div>
      </header>
    </section>
    <section class="surface admin-section">
      <header class="section-head">
        <h2>{{ 'admin.images' | translate }}</h2>
        <div class="actions">
          <a
            class="btn btn-primary"
            [class.btn-disabled]="!validSelection()"
            [attr.aria-disabled]="!validSelection()"
            [attr.href]="validSelection() ? exportImagesUrl() : null"
            download="card_images.zip"
            ><ab-icon name="download" /> {{ 'admin.exportImages' | translate }}</a
          >
          <label class="btn btn-secondary" [class.btn-disabled]="busy() || !validSelection()"
            ><ab-icon name="upload" /> {{ 'admin.importImages' | translate
            }}<input
              type="file"
              accept=".zip,application/zip"
              [disabled]="busy() || !validSelection()"
              (change)="importImages($event)"
              hidden
          /></label>
        </div>
      </header>
      @if (!validSelection()) {
        <p class="hint">{{ 'admin.selectionHint' | translate }}</p>
      }
      <div class="row option-groups">
        @for (group of selectionGroups; track group.label) {
          <div class="option-group">
            <span class="label">{{ group.label | translate }}</span>
            <div class="chips">
              @for (key of group.keys; track key) {
                <label class="chip" [class.chip-on]="selection[key]"
                  ><input type="checkbox" [(ngModel)]="selection[key]" />{{
                    'admin.selection.' + key | translate
                  }}</label
                >
              }
            </div>
          </div>
        }
      </div>
      <div class="row">
        <div class="set-picker-head">
          <span class="label">{{ 'nav.sets' | translate }}</span>
          <span class="muted">{{
            'admin.setsSelected'
              | translate: { count: selection.setCodes.length, total: sets().length }
          }}</span>
          <div class="set-picker-actions">
            <button class="btn btn-sm btn-ghost" (click)="selectSets(true)">
              {{ 'common.selectAll' | translate }}
            </button>
            <button class="btn btn-sm btn-ghost" (click)="selectSets(false)">
              {{ 'common.clear' | translate }}
            </button>
          </div>
        </div>
        <div class="set-list">
          @for (group of setGroups(); track group.series) {
            <fieldset class="set-group">
              @if (group.series) {
                <legend class="label">{{ group.series }}</legend>
              }
              <div class="set-columns">
                @for (set of group.sets; track set.set_code) {
                  <label class="set-option"
                    ><input
                      type="checkbox"
                      [checked]="selection.setCodes.includes(set.set_code)"
                      (change)="toggleSet(set.set_code, $any($event.target).checked)"
                    /><span class="set-name">{{ set.set_name }}</span>
                    <span class="set-code">{{ set.set_code }}</span></label
                  >
                }
              </div>
            </fieldset>
          }
        </div>
      </div>
      @if (uploading()) {
        <div class="row">
          <div class="progress-line">
            <span>{{ 'admin.upload' | translate }}</span>
            <span class="muted">{{ uploadPercent() }}%</span>
          </div>
          <progress max="100" [value]="uploadPercent()"></progress>
        </div>
      }
      @if (statuses()['images']; as status) {
        @if (status.status !== 'idle' || status.last_run_result) {
          <div class="row">
            <span class="row-title">
              {{ 'admin.importImages' | translate }}
              <span [class]="badgeClass(status)">{{
                'admin.status.' + status.status | translate
              }}</span>
            </span>
            <ng-container
              *ngTemplateOutlet="
                jobBody;
                context: { $implicit: status, steps: 'admin.imageSteps.' }
              "
            />
          </div>
        }
      }
    </section>

    <ng-template #jobBody let-status let-steps="steps">
      @if (status.status === 'running') {
        <div class="progress-line">
          <span>
            @if (status.step) {
              {{ steps + status.step | translate }}
            }
            @if (status.total_steps) {
              <span class="muted">({{ status.step_index }} / {{ status.total_steps }})</span>
            }
          </span>
          <span class="muted">
            @if (status.sub_total) {
              {{ status.sub_done }} / {{ status.sub_total }} ·
            }
            {{ status.percent }}%
          </span>
        </div>
        <progress max="100" [value]="status.percent"></progress>
      }
      @if (status.error) {
        <p class="error" role="alert">{{ status.error }}</p>
      }
      @let entries = resultEntries(status);
      @if (entries.length || status.last_run_at) {
        <dl class="results">
          @for (entry of entries; track entry.key) {
            <div class="result" [class.result-warning]="entry.warning">
              <dt>{{ 'admin.result.' + entry.key | translate }}</dt>
              <dd [title]="entry.detail">{{ entry.value }}</dd>
            </div>
          }
          @if (status.last_run_at) {
            <div class="result last-run">
              <dt>{{ 'admin.lastRun' | translate }}</dt>
              <dd>{{ status.last_run_at | date: 'short' }}</dd>
            </div>
          }
        </dl>
      }
    </ng-template>
  `,
  styles: `
    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-5);
      margin: calc(-1 * var(--space-2)) 0 var(--space-4);
      color: var(--color-text-muted);
      strong {
        color: var(--color-text);
        font-variant-numeric: tabular-nums;
      }
    }
    .notice {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
    }
    .notice-error {
      background: var(--color-error-bg);
      color: var(--color-error);
    }
    .notice-success {
      background: var(--color-success-bg);
      color: var(--color-success);
    }
    .admin-section {
      padding: var(--space-4) var(--space-5);
      margin-block: var(--space-4);
    }
    .section-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
      h2 {
        margin: 0;
        font-size: 1.2rem;
      }
      > .btn,
      > .actions {
        margin-left: auto;
      }
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .hint {
      margin: var(--space-2) 0 0;
      font-size: 0.875rem;
      color: var(--color-text-muted);
    }
    /* Every block inside a section is a row under a divider. */
    .row {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding-block: var(--space-3);
      border-top: 1px solid var(--color-border);
      min-width: 0;
      &:last-child {
        padding-bottom: 0;
      }
    }
    .section-head + .row,
    .hint + .row {
      margin-top: var(--space-3);
    }
    .row-main {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      .btn {
        margin-left: auto;
        flex-shrink: 0;
      }
    }
    .row-title {
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-2);
      font-weight: 600;
    }
    .label {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-muted);
    }
    .muted {
      color: var(--color-text-muted);
    }
    .progress-line {
      display: flex;
      justify-content: space-between;
      gap: var(--space-2);
      font-size: 0.875rem;
    }
    progress {
      width: 100%;
      height: 0.5rem;
      accent-color: var(--color-primary);
    }
    .error {
      margin: 0;
      font-size: 0.875rem;
    }
    /* Counts as one muted line: "Label 12 · Label 3 · Last run …". */
    .results {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-2);
      margin: 0;
      font-size: 0.85rem;
      color: var(--color-text-muted);
    }
    .result {
      display: inline-flex;
      gap: 0.3em;
      dt,
      dd {
        margin: 0;
      }
      dd {
        color: var(--color-text);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      & + .result::before {
        content: '·';
        margin-right: var(--space-2);
      }
    }
    .result-warning dd {
      padding: 0 0.45rem;
      border-radius: 999px;
      background: var(--color-warning-bg);
      color: var(--color-warning);
      cursor: help;
    }
    .last-run dd {
      font-weight: 400;
      color: inherit;
    }
    .option-groups {
      flex-direction: row;
      flex-wrap: wrap;
      gap: var(--space-3) var(--space-6);
    }
    .option-group {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .chip {
      display: inline-flex;
      align-items: center;
      padding: 0.3rem 0.75rem;
      border: 1px solid var(--color-border);
      border-radius: 999px;
      background: var(--color-surface);
      font-size: 0.875rem;
      cursor: pointer;
      user-select: none;
      transition:
        background 0.15s,
        border-color 0.15s;
      input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }
      &:hover {
        border-color: var(--color-primary);
      }
      &:has(input:focus-visible) {
        box-shadow: 0 0 0 3px var(--color-primary-light);
      }
    }
    .chip-on {
      background: var(--color-primary-light);
      border-color: var(--color-primary);
      color: var(--color-primary-dark);
      font-weight: 600;
    }
    .set-picker-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
      font-size: 0.875rem;
    }
    .set-picker-actions {
      display: flex;
      gap: var(--space-1);
      margin-left: auto;
    }
    .set-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      max-height: 24rem;
      overflow-y: auto;
      padding-block: var(--space-2);
    }
    .set-group {
      margin: 0;
      padding: 0;
      border: 0;
      min-width: 0;
      legend {
        padding: 0;
        margin-bottom: var(--space-1);
      }
    }
    .set-columns {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 14rem), 1fr));
      gap: 0 var(--space-4);
    }
    .set-option {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding-block: 0.2rem;
      font-size: 0.875rem;
      cursor: pointer;
      min-width: 0;
      input {
        margin: 0;
        accent-color: var(--color-primary);
        flex-shrink: 0;
      }
    }
    .set-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .set-code {
      margin-left: auto;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--color-text-faint);
    }
    .btn-disabled {
      opacity: 0.55;
      pointer-events: none;
    }
  `,
})
export class CatalogManagementComponent {
  private readonly api = inject(CatalogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);
  readonly steps = REFRESH_STEPS;
  readonly jobs = ['full', ...REFRESH_STEPS];
  readonly selectionKeys = [
    'french',
    'english',
    'standard',
    'variants',
    'logos',
    'symbols',
  ] as const;
  readonly stats = signal<CatalogStats | null>(null);
  readonly sets = signal<CardSet[]>([]);
  readonly selectionGroups = [
    { label: 'admin.languages', keys: this.selectionKeys.slice(0, 2) },
    { label: 'admin.imageTypes', keys: this.selectionKeys.slice(2) },
  ];
  /** Sets grouped by series, in the API's order. */
  readonly setGroups = computed(() => {
    const groups = new Map<string, CardSet[]>();
    for (const set of this.sets()) {
      const series = set.series_display_name ?? '';
      groups.set(series, [...(groups.get(series) ?? []), set]);
    }
    return [...groups].map(([series, sets]) => ({ series, sets }));
  });
  readonly statuses = signal<Record<string, RefreshStepStatus>>({});
  readonly error = signal('');
  readonly message = signal('');
  readonly uploading = signal(false);
  readonly pending = signal(false);
  readonly uploadPercent = signal(0);
  selection: ImageArchiveSelection = {
    french: true,
    english: true,
    standard: true,
    variants: true,
    logos: true,
    symbols: true,
    setCodes: [],
  };
  private timer?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  private pollGeneration = 0;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      clearTimeout(this.timer);
    });
    void this.load();
    void this.poll();
  }

  busy() {
    return (
      this.pending() ||
      this.uploading() ||
      Object.values(this.statuses()).some((s) => s.status === 'running')
    );
  }
  badgeClass(status: RefreshStepStatus) {
    return {
      running: 'badge badge-warning',
      done: 'badge badge-success',
      error: 'badge badge-error',
      idle: 'badge',
    }[status.status];
  }
  /** The finished run's counts, else the previous run's (after a reload). */
  resultEntries(status: RefreshStepStatus) {
    const result =
      status.status === 'done'
        ? status.result
        : status.status === 'idle'
          ? status.last_run_result
          : null;
    return Object.entries(result ?? {}).flatMap(([key, value]) => {
      if (!Array.isArray(value)) return [{ key, value: String(value), warning: false, detail: '' }];
      if (!value.length) return [];
      return [{ key, value: String(value.length), warning: true, detail: value.join(', ') }];
    });
  }
  validSelection() {
    return (
      this.selection.setCodes.length > 0 &&
      (this.selection.french || this.selection.english) &&
      this.selectionKeys.slice(2).some((k) => this.selection[k])
    );
  }
  selectSets(all: boolean) {
    this.selection.setCodes = all ? this.sets().map((s) => s.set_code) : [];
  }
  toggleSet(code: string, checked: boolean) {
    this.selection.setCodes = checked
      ? [...this.selection.setCodes, code]
      : this.selection.setCodes.filter((c) => c !== code);
  }
  exportImagesUrl() {
    return this.api.exportImagesUrl(this.selection);
  }

  private async load() {
    try {
      const [stats, sets] = await Promise.all([
        firstValueFrom(this.api.getStats()),
        firstValueFrom(this.api.listSets()),
      ]);
      if (this.destroyed) return;
      this.stats.set(stats);
      this.sets.set(sets);
      this.selectSets(true);
    } catch (error) {
      this.error.set(errorMessage(error));
    }
  }

  private async poll() {
    const generation = ++this.pollGeneration;
    const keys = [...this.jobs, 'images'];
    const results = await Promise.allSettled(
      keys.map((key) =>
        firstValueFrom(
          key === 'images'
            ? this.api.imageImportStatus()
            : key === 'full'
              ? this.api.refreshStatus()
              : this.api.refreshStepStatus(key),
        ),
      ),
    );
    if (this.destroyed || generation !== this.pollGeneration) return;
    const previous = this.statuses();
    const next = { ...this.statuses() };
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') next[keys[i]] = result.value;
      else this.error.set(errorMessage(result.reason));
    });
    this.statuses.set(next);
    if (keys.some((key) => previous[key]?.status === 'running' && next[key]?.status === 'done')) {
      try {
        this.stats.set(await firstValueFrom(this.api.getStats()));
      } catch (error) {
        this.error.set(errorMessage(error));
      }
    }
    if (this.destroyed || generation !== this.pollGeneration) return;
    clearTimeout(this.timer);
    // Keep checking while mounted: this also notices a job started in another tab.
    this.timer = setTimeout(
      () => void this.poll(),
      Object.values(next).some((s) => s.status === 'running') ? 1000 : 5000,
    );
  }

  async start(key: string) {
    this.error.set('');
    this.pending.set(true);
    try {
      await firstValueFrom(
        key === 'full' ? this.api.startRefresh() : this.api.startRefreshStep(key),
      );
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.pending.set(false);
      clearTimeout(this.timer);
      await this.poll();
    }
  }

  async importMetadata(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.set('');
    this.pending.set(true);
    try {
      const result = await firstValueFrom(this.api.importCatalog(await readJson(file)));
      this.message.set(this.translate.instant('admin.importResult', result));
      await this.load();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.pending.set(false);
    }
  }

  importImages(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.set('');
    this.uploading.set(true);
    this.uploadPercent.set(0);
    this.api
      .importImages(file, this.selection)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress && event.total)
            this.uploadPercent.set(Math.round((event.loaded / event.total) * 100));
          if (event.type === HttpEventType.Response) {
            this.uploading.set(false);
            clearTimeout(this.timer);
            void this.poll();
          }
        },
        error: (error) => {
          this.uploading.set(false);
          this.error.set(errorMessage(error));
          clearTimeout(this.timer);
          void this.poll();
        },
      });
  }
}
