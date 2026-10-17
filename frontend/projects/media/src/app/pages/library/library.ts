import { DecimalPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon, LanguageService } from '@shared';

import {
  STATUSES,
  TYPES,
  TYPE_ICON,
  TYPE_PLURAL,
  episodeLabel,
  statusLabel,
} from '../../media/labels';
import { MediaApi, errorMessage } from '../../media/media-api';
import { EntryStatus, EntrySummary, LibrarySort, MediaType } from '../../media/models';
import { Poster } from '../../ui/poster';
import { QuickActions } from '../../ui/quick-actions';

type Owned = '' | 'true' | 'false';

/** Poster grid with filters; filters live in the URL so back/forward keeps them. */
@Component({
  selector: 'ab-library',
  imports: [DecimalPipe, Icon, FormsModule, RouterLink, Poster, QuickActions, TranslatePipe],
  templateUrl: './library.html',
})
export class Library {
  private readonly api = inject(MediaApi);
  private readonly router = inject(Router);

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

  protected readonly types = TYPES;
  protected readonly statuses = STATUSES;
  protected readonly typePlural = TYPE_PLURAL;
  protected readonly icon = TYPE_ICON;
  protected readonly statusLabel = statusLabel;
  protected readonly sorts: LibrarySort[] = ['added', 'title', 'year', 'rating', 'finished'];

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(ActivatedRoute).queryParamMap.subscribe((params) => {
      this.type.set((params.get('type') as MediaType) ?? '');
      this.status.set((params.get('status') as EntryStatus) ?? '');
      this.owned.set((params.get('owned') as Owned) ?? '');
      this.genre.set(params.get('genre') ?? '');
      this.q.set(params.get('q') ?? '');
      this.sort.set((params.get('sort') as LibrarySort) ?? 'added');
      this.load();
    });
    this.api.genres().then(
      (g) => this.genres.set(g),
      () => {},
    );
  }

  protected async load(): Promise<void> {
    try {
      this.entries.set(
        await this.api.library({
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

  /** A translation key, or the "S1 · E3" label (which `translate` passes through). */
  protected caption(e: EntrySummary): string {
    if (e.status === 'in_progress') return episodeLabel(e) ?? statusLabel(e.status, e.item.type);
    return statusLabel(e.status, e.item.type);
  }
}
