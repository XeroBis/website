import { NgTemplateOutlet } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon } from '@shared';

import {
  FORMATS_FOR,
  TYPES,
  TYPE_ICON,
  TYPE_LABEL,
  formatLabel,
  statusLabel,
} from '../../media/labels';
import { MediaApi, errorMessage } from '../../media/media-api';
import { EntryDetail, EntryStatus, MediaType, OwnedFormat, SearchResult } from '../../media/models';

@Component({
  selector: 'ab-add',
  imports: [Icon, FormsModule, NgTemplateOutlet, RouterLink, TranslatePipe],
  templateUrl: './add.html',
})
export class Add {
  private readonly api = inject(MediaApi);
  private readonly router = inject(Router);

  protected readonly type = signal<MediaType>('book');
  protected readonly query = signal('');
  protected readonly results = signal<SearchResult[] | null>(null);
  protected readonly searching = signal(false);
  protected readonly error = signal<string | null>(null);

  /** The result being confirmed, with the options chosen for it. */
  protected readonly selected = signal<SearchResult | null>(null);
  protected readonly status = signal<EntryStatus>('want');
  protected readonly formats = signal<OwnedFormat[]>([]);
  protected readonly saving = signal(false);

  protected readonly manual = signal(false);
  protected readonly manualTitle = signal('');
  protected readonly manualCreators = signal('');
  protected readonly manualYear = signal<number | null>(null);
  protected readonly manualGenres = signal('');

  protected readonly types = TYPES;
  protected readonly typeLabel = TYPE_LABEL;
  protected readonly icon = TYPE_ICON;
  protected readonly formatsFor = FORMATS_FOR;
  protected readonly formatLabel = formatLabel;
  protected readonly statusLabel = statusLabel;
  protected readonly initialStatuses: EntryStatus[] = ['want', 'in_progress', 'done'];

  protected setType(type: MediaType): void {
    if (type === this.type()) return;
    this.type.set(type);
    this.results.set(null);
    this.selected.set(null);
    this.formats.set([]);
    if (this.query().trim()) this.search();
  }

  protected async search(): Promise<void> {
    const q = this.query().trim();
    if (!q) return;
    this.searching.set(true);
    this.error.set(null);
    this.selected.set(null);
    try {
      this.results.set(await this.api.search(this.type(), q));
    } catch (e) {
      this.results.set(null);
      this.error.set(errorMessage(e));
    } finally {
      this.searching.set(false);
    }
  }

  protected choose(result: SearchResult): void {
    if (result.library_entry_id !== null) {
      this.router.navigate(['/library', result.library_entry_id]);
      return;
    }
    this.selected.set(this.selected() === result ? null : result);
    this.status.set('want');
    this.formats.set([]);
  }

  protected toggleFormat(format: OwnedFormat): void {
    this.formats.update((f) =>
      f.includes(format) ? f.filter((x) => x !== format) : [...f, format],
    );
  }

  protected openManual(): void {
    this.manual.set(true);
    this.selected.set(null);
    this.status.set('want');
    this.formats.set([]);
    if (!this.manualTitle()) this.manualTitle.set(this.query().trim());
  }

  protected addSelected(): Promise<void> {
    const result = this.selected();
    if (!result) return Promise.resolve();
    return this.save(() => this.api.addFromSearch(result, this.status(), this.formats()));
  }

  protected addManual(): Promise<void> {
    const title = this.manualTitle().trim();
    if (!title) {
      this.error.set('add.errorTitle');
      return Promise.resolve();
    }
    const year = this.manualYear();
    return this.save(() =>
      this.api.addManual({
        type: this.type(),
        title,
        creators: this.manualCreators().trim() || null,
        year: year === null || String(year) === '' ? null : Number(year),
        genres: this.manualGenres()
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean),
        status: this.status(),
        owned_formats: this.formats(),
      }),
    );
  }

  private async save(request: () => Promise<EntryDetail>): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const entry = await request();
      this.router.navigate(['/library', entry.id]);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
