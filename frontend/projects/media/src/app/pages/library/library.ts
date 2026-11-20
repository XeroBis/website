import { DecimalPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
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
  statusLabel,
} from '../../media/labels';
import { MediaApi, errorMessage } from '../../media/media-api';
import { EntryStatus, EntrySummary, LibrarySort, MediaType, Shelf } from '../../media/models';
import { Poster } from '../../ui/poster';
import { QuickActions } from '../../ui/quick-actions';

type Owned = '' | 'true' | 'false';

/**
 * A shelf: Bibliothèque (books, with ownership) or Vidéothèque (films and
 * series), from the route's `data.shelf`. Poster grid with filters; filters
 * live in the URL so back/forward keeps them.
 */
@Component({
  selector: 'ab-library',
  imports: [DecimalPipe, Icon, FormsModule, RouterLink, Poster, QuickActions, TranslatePipe],
  templateUrl: './library.html',
})
export class Library {
  private readonly api = inject(MediaApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly shelf: Shelf = this.route.snapshot.data['shelf'] ?? 'books';
  protected readonly books = this.shelf === 'books';

  protected readonly lang = inject(LanguageService).current;
  protected readonly entries = signal<EntrySummary[] | null>(null);
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
    this.api.genres(this.shelf).then(
      (g) => this.genres.set(g),
      () => {},
    );
  }

  protected async load(): Promise<void> {
    try {
      this.entries.set(
        await this.api.library({
          shelf: this.shelf,
          type: this.type() || null,
          status: this.status() || null,
          owned: this.owned() === '' ? null : this.owned() === 'true',
          genre: this.genre() || null,
          q: this.q().trim() || null,
          sort: this.sort(),
        }),
      );
      this.error.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
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
