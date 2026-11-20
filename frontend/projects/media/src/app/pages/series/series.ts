import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { Icon, httpStatus } from '@shared';

import { statusLabel } from '../../media/labels';
import { MediaApi, errorMessage } from '../../media/media-api';
import { BookSeriesDetail, EntrySummary } from '../../media/models';
import { Poster } from '../../ui/poster';

/** A book series: its volumes in order, with one-tap read/owned per volume. */
@Component({
  selector: 'ab-series',
  imports: [FormsModule, Icon, Poster, RouterLink, TranslatePipe],
  templateUrl: './series.html',
})
export class SeriesPage {
  private readonly api = inject(MediaApi);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly translate = inject(TranslateService);

  /** Route param. */
  readonly id = input.required<string>();

  protected readonly series = signal<BookSeriesDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly name = signal('');

  protected readonly statusLabel = statusLabel;

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.series.set(null);
      this.run(() => this.api.series(id));
    });
    effect(() => {
      const s = this.series();
      if (s) this.title.setTitle(`${s.name} · Media`);
    });
  }

  private async run(request: () => Promise<BookSeriesDetail>): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const series = await request();
      this.series.set(series);
      this.name.set(series.name);
      return true;
    } catch (e) {
      this.error.set(httpStatus(e) === 404 ? 'series.notFound' : errorMessage(e));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private get seriesId(): number {
    return this.series()!.id;
  }

  protected rename(): void {
    const name = this.name().trim();
    if (!name || name === this.series()!.name) {
      this.name.set(this.series()!.name);
      return;
    }
    this.run(() => this.api.renameSeries(this.seriesId, name));
  }

  /** One volume: an undated read, or flip ownership. Then refresh the counts. */
  protected async readOne(entry: EntrySummary): Promise<void> {
    await this.refreshAfter(() => this.api.act(entry.id, 'finish', true));
  }

  protected async toggleOwned(entry: EntrySummary): Promise<void> {
    await this.refreshAfter(() => this.api.update(entry.id, { owned: !entry.owned }));
  }

  private async refreshAfter(change: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    try {
      await change();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
    await this.run(() => this.api.series(this.seriesId));
  }

  protected async remove(): Promise<void> {
    const s = this.series()!;
    if (!confirm(this.translate.instant('series.confirmDelete', { name: s.name }))) return;
    try {
      await this.api.deleteSeries(s.id);
      this.router.navigate(['/books']);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
