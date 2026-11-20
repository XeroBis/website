import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon, LanguageService } from '@shared';

import { TYPES, TYPE_ICON, TYPE_LABEL, TYPE_PLURAL } from '../../media/labels';
import { LocalTitlePipe } from '../../media/local-title';
import { MediaApi, errorMessage } from '../../media/media-api';
import { JournalEntry, JournalEvent, MediaType } from '../../media/models';
import { Poster } from '../../ui/poster';

interface Group {
  /** ISO day (month view) or `YYYY-MM-01` (year view), for the heading. */
  key: string;
  events: JournalEntry[];
}

/**
 * What was started and finished in a month or a year. The period and filters
 * live in the URL: `?year=2026&month=11` (no `month` = the whole year); no
 * `year` = the current month.
 */
@Component({
  selector: 'ab-journal',
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    Icon,
    LocalTitlePipe,
    Poster,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './journal.html',
})
export class Journal {
  private readonly api = inject(MediaApi);
  private readonly router = inject(Router);
  protected readonly lang = inject(LanguageService).current;

  protected readonly year = signal(0);
  /** 1-12, or null for the year view. */
  protected readonly month = signal<number | null>(null);
  protected readonly type = signal<MediaType | ''>('');
  protected readonly event = signal<JournalEvent | ''>('');

  protected readonly events = signal<JournalEntry[] | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly types = TYPES;
  protected readonly typePlural = TYPE_PLURAL;
  protected readonly typeLabel = TYPE_LABEL;
  protected readonly icon = TYPE_ICON;

  /** First day of the period, for the heading's date pipe. */
  protected readonly periodStart = computed(() => isoDay(this.year(), this.month() ?? 1, 1));

  /** By day in the month view, by month in the year view (events come newest first). */
  protected readonly groups = computed((): Group[] => {
    const groups: Group[] = [];
    const byMonth = this.month() === null;
    for (const e of this.events() ?? []) {
      const key = byMonth ? `${e.date.slice(0, 7)}-01` : e.date;
      const last = groups.at(-1);
      if (last?.key === key) last.events.push(e);
      else groups.push({ key, events: [e] });
    }
    return groups;
  });

  /** Finishes per type, for the summary line (types with none left out). */
  protected readonly finished = computed(() => {
    const counts = new Map<MediaType, number>();
    for (const e of this.events() ?? []) {
      if (e.event === 'finished')
        counts.set(e.entry.item.type, (counts.get(e.entry.item.type) ?? 0) + 1);
    }
    return TYPES.filter((t) => counts.has(t)).map((t) => ({ type: t, count: counts.get(t)! }));
  });

  constructor() {
    inject(ActivatedRoute).queryParamMap.subscribe((params) => {
      const today = new Date();
      const year = Number(params.get('year'));
      if (Number.isInteger(year) && year >= 1 && year <= 9999) {
        const month = Number(params.get('month'));
        this.year.set(year);
        this.month.set(Number.isInteger(month) && month >= 1 && month <= 12 ? month : null);
      } else {
        this.year.set(today.getFullYear());
        this.month.set(today.getMonth() + 1);
      }
      const type = params.get('type') as MediaType | null;
      this.type.set(type && TYPES.includes(type) ? type : '');
      const event = params.get('event');
      this.event.set(event === 'started' || event === 'finished' ? event : '');
      this.load();
    });
  }

  private async load(): Promise<void> {
    try {
      this.events.set(
        await this.api.journal({
          year: this.year(),
          month: this.month(),
          type: this.type() || null,
          event: this.event() || null,
        }),
      );
      this.error.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  private go(changes: { year?: number; month?: number | null }): void {
    const year = changes.year ?? this.year();
    const month = 'month' in changes ? changes.month : this.month();
    this.router.navigate([], {
      replaceUrl: true,
      queryParams: {
        year,
        month: month ?? null,
        type: this.type() || null,
        event: this.event() || null,
      },
    });
  }

  protected apply(): void {
    this.go({});
  }

  protected setType(type: MediaType | ''): void {
    this.type.set(type);
    this.apply();
  }

  protected showYear(): void {
    this.go({ month: null });
  }

  protected showMonth(): void {
    if (this.month() !== null) return;
    const today = new Date();
    // This year: the current month; another year: its January.
    this.go({ month: this.year() === today.getFullYear() ? today.getMonth() + 1 : 1 });
  }

  /** ‹ › : one month, or one year in the year view. */
  protected step(delta: 1 | -1): void {
    const month = this.month();
    if (month === null) {
      this.go({ year: this.year() + delta });
      return;
    }
    const index = this.year() * 12 + (month - 1) + delta;
    this.go({ year: Math.floor(index / 12), month: (index % 12) + 1 });
  }
}

function isoDay(year: number, month: number, day: number): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}
