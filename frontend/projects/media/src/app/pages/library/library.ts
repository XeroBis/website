import { CdkDrag, CdkDragEnd, CdkDragMove } from '@angular/cdk/drag-drop';
import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon, LanguageService } from '@shared';

import {
  SHELF_TYPES,
  STATUSES,
  TYPE_ICON,
  TYPE_PLURAL,
  episodeLabel,
  seriesNameFromTitle,
  statusLabel,
  volumeFromTitle,
} from '../../media/labels';
import { LocalTitlePipe, localTitle } from '../../media/local-title';
import { MediaApi, errorMessage } from '../../media/media-api';
import {
  BookSeries,
  EntryStatus,
  EntrySummary,
  LibrarySort,
  MediaType,
  Shelf,
} from '../../media/models';
import { Poster } from '../../ui/poster';
import { QuickActions } from '../../ui/quick-actions';
import { Dialogs } from '../../ui/dialogs';

type Owned = '' | 'true' | 'false';

/** A grid cell: an entry, or (books) one card for a whole series. */
type Card = { entry: EntrySummary; series?: never } | { series: BookSeries; entry?: never };

/**
 * A shelf: Bibliothèque (books, with ownership) or Vidéothèque (films and
 * series), from the route's `data.shelf`. Poster grid with filters; filters
 * live in the URL so back/forward keeps them. Books: drop a book on another to
 * make a series of the two, or on a series to add it.
 */
@Component({
  selector: 'ab-library',
  imports: [
    CdkDrag,
    DecimalPipe,
    Icon,
    FormsModule,
    LocalTitlePipe,
    RouterLink,
    Poster,
    QuickActions,
    TranslatePipe,
  ],
  templateUrl: './library.html',
})
export class Library {
  private readonly api = inject(MediaApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialogs = inject(Dialogs);

  protected readonly shelf: Shelf = this.route.snapshot.data['shelf'] ?? 'books';
  protected readonly books = this.shelf === 'books';

  protected readonly lang = inject(LanguageService).current;
  protected readonly entries = signal<EntrySummary[] | null>(null);
  /** Books shelf: the user's series, for the series cards' counts and covers. */
  private readonly allSeries = signal<BookSeries[]>([]);
  protected readonly genres = signal<string[]>([]);
  protected readonly error = signal<string | null>(null);

  protected readonly type = signal<MediaType | ''>('');
  protected readonly status = signal<EntryStatus | ''>('');
  protected readonly owned = signal<Owned>('');
  protected readonly genre = signal('');
  protected readonly q = signal('');
  protected readonly sort = signal<LibrarySort>('added');

  /** Type chips: only the Vidéothèque mixes types. */
  protected readonly types = this.books ? [] : SHELF_TYPES[this.shelf];
  protected readonly statuses = STATUSES;
  protected readonly typePlural = TYPE_PLURAL;
  protected readonly icon = TYPE_ICON;
  protected readonly statusLabel = statusLabel;
  protected readonly sorts: LibrarySort[] = ['added', 'title', 'year', 'rating', 'finished'];

  /**
   * Volumes of a series collapse into one card, where its first matching
   * volume is in the sort.
   */
  protected readonly cards = computed((): Card[] | null => {
    const list = this.entries();
    if (!list) return null;
    const series = new Map(this.allSeries().map((s) => [s.id, s]));
    const shown = new Set<number>();
    const cards: Card[] = [];
    for (const entry of list) {
      const s = entry.series_id === null ? undefined : series.get(entry.series_id);
      if (!s) cards.push({ entry });
      else if (!shown.has(s.id)) {
        shown.add(s.id);
        cards.push({ series: s });
      }
    }
    return cards;
  });

  /** Books: the book being dragged, and the card under it (`e<id>` / `s<id>`). */
  protected readonly dragged = signal<EntrySummary | null>(null);
  protected readonly dropTarget = signal<string | null>(null);
  protected readonly filing = signal(false);

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      const type = params.get('type') as MediaType | null;
      this.type.set(type && this.types.includes(type) ? type : '');
      this.status.set((params.get('status') as EntryStatus) ?? '');
      this.owned.set(this.books ? ((params.get('owned') as Owned) ?? '') : '');
      this.genre.set(params.get('genre') ?? '');
      this.q.set(params.get('q') ?? '');
      this.sort.set((params.get('sort') as LibrarySort) ?? 'added');
      this.load();
    });
    // A click right after a drag (released over a link) isn't followed.
    const host = inject(ElementRef).nativeElement as HTMLElement;
    const swallow = (event: MouseEvent) => {
      if (!this.swallowClick) return;
      event.preventDefault();
      event.stopPropagation();
    };
    host.addEventListener('click', swallow, true);
    inject(DestroyRef).onDestroy(() => host.removeEventListener('click', swallow, true));
    this.api.genres(this.shelf).then(
      (g) => this.genres.set(g),
      () => {},
    );
  }

  protected async load(): Promise<void> {
    try {
      // Both at once: entries without their series would briefly show every
      // volume as its own card before collapsing them.
      const [entries, series] = await Promise.all([
        this.api.library({
          shelf: this.shelf,
          type: this.type() || null,
          status: this.status() || null,
          owned: this.owned() === '' ? null : this.owned() === 'true',
          genre: this.genre() || null,
          q: this.q().trim() || null,
          sort: this.sort(),
        }),
        this.books ? this.api.allSeries() : Promise.resolve([]),
      ]);
      this.allSeries.set(series);
      this.entries.set(entries);
      this.error.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  /** Entries being removed from the card's trash button. */
  protected readonly removing = signal<ReadonlySet<number>>(new Set());

  /** Removes an entry straight from its card, after the same confirm as its page. */
  protected async remove(entry: EntrySummary): Promise<void> {
    if (this.removing().has(entry.id)) return;
    const title = localTitle(entry.item, this.lang());
    const ok = await this.dialogs.confirm({
      title: 'entry.remove',
      message: 'entry.confirmRemove',
      params: { title },
      confirm: 'dialog.remove',
      danger: true,
    });
    if (!ok) return;
    this.removing.update((s) => new Set(s).add(entry.id));
    try {
      await this.api.remove(entry.id);
      this.entries.update((list) => (list ?? []).filter((e) => e.id !== entry.id));
      // Genres and series counts may have changed.
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.removing.update((s) => {
        const next = new Set(s);
        next.delete(entry.id);
        return next;
      });
    }
  }

  /** Push the current filters into the URL, which triggers a reload. */
  protected apply(): void {
    clearTimeout(this.searchTimer);
    this.router.navigate([], {
      replaceUrl: true,
      queryParams: {
        type: this.type() || null,
        status: this.status() || null,
        owned: this.owned() || null,
        genre: this.genre() || null,
        q: this.q().trim() || null,
        sort: this.sort() === 'added' ? null : this.sort(),
      },
    });
  }

  protected setType(type: MediaType | ''): void {
    this.type.set(type);
    this.apply();
  }

  protected searchTyped(): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.apply(), 300);
  }

  protected cardKey(card: Card): string {
    return card.series ? `s${card.series.id}` : `e${card.entry!.id}`;
  }

  /** Long-press on touch screens, so a swipe still scrolls the grid. */
  protected readonly dragDelay = { touch: 350, mouse: 0 };

  protected dragStarted(entry: EntrySummary): void {
    this.dragged.set(entry);
  }

  /** Highlights the card under the pointer (the dragged one ignores the pointer). */
  protected dragMoved(event: CdkDragMove<EntrySummary>): void {
    const card = this.cardAt(event.pointerPosition);
    this.dropTarget.set(card ? this.cardKey(card) : null);
  }

  protected async dragEnded(event: CdkDragEnd<EntrySummary>): Promise<void> {
    event.source.reset();
    const target = this.cardAt(event.dropPoint);
    const dragged = this.dragged();
    this.dragged.set(null);
    this.dropTarget.set(null);
    // The pointer is released over a link: don't follow it.
    this.swallowClick = true;
    setTimeout(() => (this.swallowClick = false));
    if (dragged && target) await this.dropOn(dragged, target);
  }

  private swallowClick = false;

  /** The card at a point other than the dragged book's (cards carry `data-drop`). */
  private cardAt(point: { x: number; y: number }): Card | null {
    const el = document.elementFromPoint(point.x, point.y)?.closest('[data-drop]');
    const key = el?.getAttribute('data-drop');
    const card = this.cards()?.find((c) => this.cardKey(c) === key) ?? null;
    return card && card.entry?.id !== this.dragged()?.id ? card : null;
  }

  /** A book dropped on a series joins it; on a book, the two make a new series. */
  protected async dropOn(dragged: EntrySummary, card: Card): Promise<void> {
    if (card.entry?.id === dragged.id) return;
    this.filing.set(true);
    this.error.set(null);
    try {
      if (card.series) await this.joinSeries(dragged, card.series.id);
      else if (card.entry!.series_id !== null)
        await this.joinSeries(dragged, card.entry!.series_id);
      else if (!(await this.makeSeries(card.entry!, dragged))) return;
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.filing.set(false);
    }
  }

  private title(entry: EntrySummary): string {
    return localTitle(entry.item, this.lang());
  }

  /** Numbered from its title, else after the series' highest volume. */
  private async joinSeries(entry: EntrySummary, seriesId: number): Promise<void> {
    const series = await this.api.series(seriesId);
    const volume =
      volumeFromTitle(this.title(entry)) ??
      Math.max(0, ...series.entries.map((e) => e.series_volume ?? 0)) + 1;
    await this.api.update(entry.id, { series_id: seriesId, series_volume: volume });
  }

  /**
   * Asks for the name (guessed from the target's title). An existing series of
   * that name is reused. False when cancelled.
   */
  private async makeSeries(target: EntrySummary, dragged: EntrySummary): Promise<boolean> {
    const name = await this.dialogs.prompt({
      title: 'dialog.newSeries',
      label: 'library.newSeriesPrompt',
      value: seriesNameFromTitle(this.title(target)),
      confirm: 'dialog.create',
    });
    if (!name) return false;
    const existing = this.allSeries().find((s) => s.name.toLowerCase() === name.toLowerCase());
    const seriesId = existing?.id ?? (await this.api.createSeries(name)).id;
    for (const entry of [target, dragged]) {
      await this.api.update(entry.id, {
        series_id: seriesId,
        series_volume: volumeFromTitle(this.title(entry)),
      });
    }
    return true;
  }

  /** The Add page, with the type preset from the shelf (and its type chip). */
  protected addQuery(): { type: MediaType } {
    return { type: this.books ? 'book' : this.type() || 'film' };
  }

  /** A translation key, or the "S1 · E3" label (which `translate` passes through). */
  protected caption(e: EntrySummary): string {
    if (e.status === 'in_progress') return episodeLabel(e) ?? statusLabel(e.status, e.item.type);
    return statusLabel(e.status, e.item.type);
  }
}
