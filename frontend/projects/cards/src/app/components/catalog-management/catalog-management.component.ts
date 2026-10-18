import { DatePipe, JsonPipe } from '@angular/common';
import { HttpEventType } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
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
  imports: [Icon, DatePipe, JsonPipe, FormsModule, TranslatePipe, Icon],
  template: `
    <h1>{{ 'nav.catalogManagement' | translate }}</h1>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (message()) {
      <p role="status">{{ message() }}</p>
    }
    @if (stats(); as s) {
      <p>
        {{
          'admin.stats'
            | translate: { cards: s.total_cards, sets: s.total_sets, names: s.distinct_card_names }
        }}
      </p>
      <dl>
        @for (entry of variantCounts(); track entry[0]) {
          <dt>{{ entry[0] }}</dt>
          <dd>{{ entry[1] }}</dd>
        }
      </dl>
    }
    <section class="surface admin-section">
      <h2>{{ 'admin.refresh' | translate }}</h2>
      @for (key of jobs; track key) {
        <div class="job">
          <button class="btn btn-secondary" [disabled]="busy()" (click)="start(key)">
            <ab-icon name="play" /> {{ 'admin.steps.' + key | translate }}
          </button>
          @if (statuses()[key]; as status) {
            <span
              >{{ 'admin.status.' + status.status | translate }} · {{ status.step_label }}
              {{ status.sub_done }} / {{ status.sub_total }}</span
            >
            <progress max="100" [value]="status.percent"></progress>
            @if (status.total_steps) {
              <span>{{ status.step_index }} / {{ status.total_steps }}</span>
            }
            @if (status.error) {
              <p class="error" role="alert">{{ status.error }}</p>
            }
            @if (status.status === 'done') {
              <pre>{{ status.result | json }}</pre>
            }
            @if (status.last_run_at) {
              <small>{{ status.last_run_at | date: 'short' }}</small>
            }
          }
        </div>
      }
    </section>
    <section class="surface admin-section">
      <h2>{{ 'admin.metadata' | translate }}</h2>
      <a class="btn btn-secondary" href="/api/cards/catalog/export" download="cards_metadata.json"
        ><ab-icon name="download" /> {{ 'common.export' | translate }}</a
      >
      <label class="btn btn-secondary"
        ><ab-icon name="upload" /> {{ 'common.import' | translate
        }}<input
          type="file"
          accept=".json,application/json"
          [disabled]="busy()"
          (change)="importMetadata($event)"
          hidden
      /></label>
    </section>
    <section class="surface admin-section">
      <h2>{{ 'admin.images' | translate }}</h2>
      <div class="filters">
        @for (key of selectionKeys; track key) {
          <label
            ><input type="checkbox" [(ngModel)]="selection[key]" />{{
              'admin.selection.' + key | translate
            }}</label
          >
        }
      </div>
      <fieldset>
        <legend>{{ 'nav.sets' | translate }}</legend>
        <button class="btn btn-secondary" (click)="selectSets(true)">
          {{ 'common.selectAll' | translate }}
        </button>
        <button class="btn btn-secondary" (click)="selectSets(false)">
          {{ 'common.clear' | translate }}
        </button>
        <div class="filters">
          @for (set of sets(); track set.set_code) {
            <label
              ><input
                type="checkbox"
                [checked]="selection.setCodes.includes(set.set_code)"
                (change)="toggleSet(set.set_code, $any($event.target).checked)"
              />{{ set.set_name }} ({{ set.set_code }})</label
            >
          }
        </div>
      </fieldset>
      @if (validSelection()) {
        <a class="btn btn-secondary" [href]="exportImagesUrl()" download="card_images.zip"
          ><ab-icon name="download" /> {{ 'admin.exportImages' | translate }}</a
        >
      }
      <label class="btn btn-secondary"
        ><ab-icon name="upload" /> {{ 'admin.importImages' | translate
        }}<input
          type="file"
          accept=".zip,application/zip"
          [disabled]="busy() || !validSelection()"
          (change)="importImages($event)"
          hidden
      /></label>
      @if (uploading()) {
        <p>{{ 'admin.upload' | translate }} {{ uploadPercent() }}%</p>
        <progress max="100" [value]="uploadPercent()"></progress>
      }
      @if (statuses()['images']; as status) {
        <p>
          {{ 'admin.status.' + status.status | translate }} · {{ status.step_label }}
          {{ status.sub_done }} / {{ status.sub_total }}
        </p>
        <progress max="100" [value]="status.percent"></progress>
        @if (status.error) {
          <p class="error" role="alert">{{ status.error }}</p>
        }
        @if (status.status === 'done') {
          <pre>{{ status.result | json }}</pre>
        }
      }
    </section>
  `,
  styles: `
    .admin-section {
      padding: var(--space-4);
      margin-block: var(--space-4);
    }
    .job {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      align-items: center;
      margin-block: var(--space-3);
    }
    pre {
      white-space: pre-wrap;
    }
    fieldset {
      margin-block: var(--space-4);
    }
    dl {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    dd {
      margin: 0 1rem 0 0;
    }
  `,
})
export class CatalogManagementComponent {
  private readonly api = inject(CatalogService);
  private readonly destroyRef = inject(DestroyRef);
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

  variantCounts() {
    return Object.entries(this.stats()?.variant_counts ?? {});
  }
  busy() {
    return (
      this.pending() ||
      this.uploading() ||
      Object.values(this.statuses()).some((s) => s.status === 'running')
    );
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
      this.message.set(JSON.stringify(result));
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
