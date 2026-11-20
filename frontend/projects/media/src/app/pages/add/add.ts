import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon, Language, LanguageService } from '@shared';

import {
  TYPES,
  TYPE_ICON,
  TYPE_LABEL,
  shelfUrl,
  statusLabel,
  volumeFromTitle,
} from '../../media/labels';
import { canScan } from '../../media/barcode';
import { normalizeIsbn } from '../../media/isbn';
import { LocalTitlePipe, localTitle } from '../../media/local-title';
import { MediaApi, errorMessage } from '../../media/media-api';
import { IsbnScanner } from '../../ui/isbn-scanner';
import { Poster } from '../../ui/poster';
import {
  AddOptions,
  BookSeriesDetail,
  EntryDetail,
  EntryStatus,
  EntrySummary,
  MediaType,
  SearchResult,
} from '../../media/models';

/** The confirm panel's status choices: "done" today, or with the date unknown. */
type InitialStatus = EntryStatus | 'done_undated';

/** Google Books' page size: a full page means there may be more. */
const BOOK_PAGE = 20;

/**
 * Search and add. `?type=` presets the type; `?series=<id>` (the series page's
 * Add volumes) ties every add to that series, numbering volumes from titles,
 * and also offers the library's books that aren't in a series yet.
 */
@Component({
  selector: 'ab-add',
  imports: [
    Icon,
    FormsModule,
    IsbnScanner,
    LocalTitlePipe,
    NgTemplateOutlet,
    Poster,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './add.html',
})
export class Add {
  private readonly api = inject(MediaApi);
  private readonly router = inject(Router);
  private readonly params = inject(ActivatedRoute).snapshot.queryParamMap;
  protected readonly lang = inject(LanguageService).current;

  /** Set when adding volumes to a series. */
  protected readonly series = signal<BookSeriesDetail | null>(null);
  private readonly seriesId = Number(this.params.get('series')) || null;

  /** Preset by the shelf's Add button (`?type=`); a series means books. */
  protected readonly type = signal<MediaType>(
    this.seriesId ? 'book' : initialType(this.params.get('type')),
  );
  protected readonly query = signal('');
  /** Books: when filled, the search looks up this ISBN only. */
  protected readonly isbn = signal('');
  protected readonly canSearch = computed(
    () => !!this.query().trim() || (this.type() === 'book' && !!this.isbn().trim()),
  );
  /** The barcode scanner: offered where the browser can open a camera. */
  protected readonly canScan = canScan();
  protected readonly scanning = signal(false);
  /** What the shown results were searched with, for More results. */
  private searched: { q: string; isbn: string | null } | null = null;
  /** Books: the editions' language, the UI's by default (you may own either). */
  protected readonly bookLang = signal<Language>(this.lang());
  protected readonly bookLangs: Language[] = ['en', 'fr'];
  protected readonly results = signal<SearchResult[] | null>(null);
  protected readonly searching = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly hasMore = signal(false);
  private page = 1;
  protected readonly error = signal<string | null>(null);

  /** Results being added by a quick button (by external id), and their errors. */
  protected readonly adding = signal<ReadonlySet<string>>(new Set());
  protected readonly rowErrors = signal<Readonly<Record<string, string>>>({});

  /** The result being confirmed, with the options chosen for it. */
  protected readonly selected = signal<SearchResult | null>(null);
  protected readonly status = signal<InitialStatus>('want');
  /** Books only. */
  protected readonly owned = signal(false);
  protected readonly volume = signal<number | null>(null);
  protected readonly saving = signal(false);

  protected readonly manual = signal(false);
  protected readonly manualTitle = signal('');
  protected readonly manualCreators = signal('');
  protected readonly manualYear = signal<number | null>(null);
  protected readonly manualGenres = signal('');

  protected readonly types = TYPES;
  protected readonly typeLabel = TYPE_LABEL;
  protected readonly icon = TYPE_ICON;
  protected readonly initialStatuses: InitialStatus[] = [
    'want',
    'in_progress',
    'done',
    'done_undated',
  ];
  protected readonly backUrl = computed(() =>
    this.seriesId ? `/series/${this.seriesId}` : shelfUrl(this.type()),
  );

  /** Series mode: the library's books in no series, to file under this one. */
  protected readonly loose = signal<EntrySummary[] | null>(null);
  protected readonly looseFilter = signal('');
  protected readonly shownLoose = computed(() => {
    const q = this.looseFilter().trim().toLowerCase();
    const list = this.loose() ?? [];
    if (!q) return list;
    return list.filter((e) =>
      [localTitle(e.item, this.lang()), e.item.title, e.item.creators ?? ''].some((t) =>
        t.toLowerCase().includes(q),
      ),
    );
  });
  /** Entries (library list) or results (by external id) being filed under the series. */
  protected readonly filing = signal<ReadonlySet<number | string>>(new Set());

  /** Volume numbers given during this visit, so "next number" keeps counting. */
  private readonly usedVolumes: number[] = [];

  constructor() {
    if (this.seriesId) {
      this.api.series(this.seriesId).then(
        (s) => this.series.set(s),
        (e) => this.error.set(errorMessage(e)),
      );
      this.api.library({ shelf: 'books', sort: 'title' }).then(
        (list) => this.loose.set(list.filter((e) => e.series_id === null)),
        (e) => this.error.set(errorMessage(e)),
      );
    }
  }

  /** Series mode: files a library book under the series, numbered from its title. */
  protected async fileLoose(entry: EntrySummary): Promise<void> {
    if (this.filing().has(entry.id)) return;
    this.setFiling(entry.id, true);
    this.error.set(null);
    try {
      await this.api.update(entry.id, this.fileOptions(entry.item.title));
      this.loose.update((list) => (list ?? []).filter((e) => e.id !== entry.id));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.setFiling(entry.id, false);
    }
  }

  /** Series mode: a search result already in the library, filed under the series. */
  protected fileResult(result: SearchResult): Promise<void> {
    const id = result.library_entry_id;
    if (id === null) return Promise.resolve();
    return this.onRow(result, async () => {
      const entry = await this.api.update(id, this.fileOptions(result.title));
      this.loose.update((list) => (list ?? []).filter((e) => e.id !== id));
      return { ...result, library_series_id: entry.series_id };
    });
  }

  protected inThisSeries(result: SearchResult): boolean {
    return this.seriesId !== null && result.library_series_id === this.seriesId;
  }

  private fileOptions(title: string): { series_id: number; series_volume: number } {
    const volume = this.volumeFor(title);
    this.usedVolumes.push(volume);
    return { series_id: this.seriesId!, series_volume: volume };
  }

  private setFiling(id: number, on: boolean): void {
    this.filing.update((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  protected statusText(s: InitialStatus): string {
    if (s === 'done_undated')
      return this.type() === 'book' ? 'add.readUndated' : 'add.watchedUndated';
    if (s === 'done') return this.type() === 'book' ? 'add.readToday' : 'add.watchedToday';
    return statusLabel(s, this.type());
  }

  protected setType(type: MediaType): void {
    if (type === this.type() || this.seriesId) return;
    this.type.set(type);
    this.results.set(null);
    this.selected.set(null);
    this.owned.set(false);
    this.searched = null;
    if (this.canSearch()) this.search();
  }

  protected setBookLang(lang: Language): void {
    if (lang === this.bookLang()) return;
    this.bookLang.set(lang);
    // An ISBN search has no language.
    if (this.results() !== null && this.searched && !this.searched.isbn) this.search();
  }

  /** The `lang` sent with a search: books only, and not with an ISBN. */
  private searchLang(isbn: string | null): Language | null {
    return this.type() === 'book' && !isbn ? this.bookLang() : null;
  }

  protected async search(): Promise<void> {
    if (!this.canSearch()) return;
    const rawIsbn = this.type() === 'book' ? this.isbn().trim() : '';
    const isbn = rawIsbn ? normalizeIsbn(rawIsbn) : null;
    if (rawIsbn && !isbn) {
      this.error.set('add.errorIsbn');
      return;
    }
    const q = isbn ? '' : this.query().trim();
    this.searching.set(true);
    this.error.set(null);
    this.selected.set(null);
    this.rowErrors.set({});
    this.page = 1;
    this.searched = { q, isbn };
    try {
      const hits = await this.api.search(this.type(), q, 1, this.searchLang(isbn), isbn);
      this.results.set(hits);
      this.hasMore.set(this.type() === 'book' && hits.length >= BOOK_PAGE);
    } catch (e) {
      this.results.set(null);
      this.hasMore.set(false);
      this.error.set(errorMessage(e));
    } finally {
      this.searching.set(false);
    }
  }

  /** A scanned barcode's ISBN: fills the field and searches it. */
  protected onScanned(isbn: string): void {
    this.scanning.set(false);
    this.isbn.set(isbn);
    this.search();
  }

  protected onScanClosed(error: string | null): void {
    this.scanning.set(false);
    if (error) this.error.set(error);
  }

  /** Books: the next 20 Google Books results, appended. */
  protected async more(): Promise<void> {
    if (!this.searched) return;
    const { q, isbn } = this.searched;
    this.loadingMore.set(true);
    this.error.set(null);
    try {
      const hits = await this.api.search(
        this.type(),
        q,
        this.page + 1,
        this.searchLang(isbn),
        isbn,
      );
      this.page += 1;
      const seen = new Set(this.results()?.map((r) => r.external_id));
      this.results.update((list) => [
        ...(list ?? []),
        ...hits.filter((h) => !seen.has(h.external_id)),
      ]);
      this.hasMore.set(hits.length >= BOOK_PAGE);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loadingMore.set(false);
    }
  }

  protected choose(result: SearchResult): void {
    if (result.library_entry_id !== null) {
      this.router.navigate(['/entries', result.library_entry_id]);
      return;
    }
    this.selected.set(this.selected() === result ? null : result);
    this.status.set('want');
    this.owned.set(false);
    this.volume.set(this.seriesId ? this.volumeFor(result.title) : null);
  }

  /** The number in the title, else the next after the series' highest. */
  private volumeFor(title: string): number {
    const found = volumeFromTitle(title);
    if (found !== null) return found;
    const numbers = [
      ...(this.series()?.entries.map((e) => e.series_volume ?? 0) ?? []),
      ...this.usedVolumes,
    ];
    return Math.max(0, ...numbers) + 1;
  }

  private seriesOptions(volume: number | null): Partial<AddOptions> {
    if (!this.seriesId) return {};
    if (volume !== null) this.usedVolumes.push(volume);
    return { series_id: this.seriesId, series_volume: volume };
  }

  /**
   * The row's toggles: the first tap adds the result (staying on the page),
   * later taps change that entry, so Read and Owned combine in any order.
   */
  protected addWant(result: SearchResult): Promise<void> {
    return this.onRow(result, () => this.add(result, 'want', false));
  }

  /** Read / Watched, with the date unknown (bulk adds are mostly old reads). */
  protected markRead(result: SearchResult): Promise<void> {
    if (result.library_status === 'done') return Promise.resolve();
    return this.onRow(result, async () => {
      if (result.library_entry_id === null) return this.add(result, 'done', false);
      const entry = await this.api.act(result.library_entry_id, 'finish', true);
      return { ...result, library_status: entry.status };
    });
  }

  /** Books: toggles ownership (adding the book, to read, if it's new). */
  protected toggleOwned(result: SearchResult): Promise<void> {
    return this.onRow(result, async () => {
      if (result.library_entry_id === null) return this.add(result, 'want', true);
      const entry = await this.api.update(result.library_entry_id, {
        owned: !result.library_owned,
      });
      return { ...result, library_owned: entry.owned };
    });
  }

  private async add(
    result: SearchResult,
    status: EntryStatus,
    owned: boolean,
  ): Promise<SearchResult> {
    const entry = await this.api.addFromSearch(result, {
      status,
      undated: status === 'done',
      owned: result.type === 'book' && owned,
      ...this.seriesOptions(this.seriesId ? this.volumeFor(result.title) : null),
    });
    if (this.selected() === result) this.selected.set(null);
    return {
      ...result,
      library_entry_id: entry.id,
      library_status: entry.status,
      library_owned: entry.owned,
    };
  }

  /** Runs one change on a row (one at a time per row), then swaps in its new state. */
  private async onRow(result: SearchResult, change: () => Promise<SearchResult>): Promise<void> {
    const id = result.external_id;
    if (this.adding().has(id)) return;
    this.adding.update((s) => new Set(s).add(id));
    this.rowErrors.update((errors) => {
      const next = { ...errors };
      delete next[id];
      return next;
    });
    try {
      const updated = await change();
      this.results.update((list) => (list ?? []).map((r) => (r.external_id === id ? updated : r)));
    } catch (e) {
      this.rowErrors.update((errors) => ({ ...errors, [id]: errorMessage(e) }));
    } finally {
      this.adding.update((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  protected openManual(): void {
    this.manual.set(true);
    this.selected.set(null);
    this.status.set('want');
    this.owned.set(false);
    this.volume.set(this.seriesId ? this.volumeFor(this.query()) : null);
    if (!this.manualTitle()) this.manualTitle.set(this.query().trim());
  }

  private options(): AddOptions {
    const status = this.status();
    const volume = this.volume();
    return {
      status: status === 'done_undated' ? 'done' : status,
      undated: status === 'done_undated',
      owned: this.type() === 'book' && this.owned(),
      ...this.seriesOptions(volume === null || String(volume) === '' ? null : Number(volume)),
    };
  }

  protected addSelected(): Promise<void> {
    const result = this.selected();
    if (!result) return Promise.resolve();
    return this.save(() => this.api.addFromSearch(result, this.options()));
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
        ...this.options(),
      }),
    );
  }

  private async save(request: () => Promise<EntryDetail>): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const entry = await request();
      this.router.navigate(['/entries', entry.id]);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}

function initialType(value: string | null): MediaType {
  return TYPES.includes(value as MediaType) ? (value as MediaType) : 'book';
}
