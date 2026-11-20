import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { Icon, IconName, LanguageService, httpStatus } from '@shared';

import {
  TYPE_ICON,
  TYPE_LABEL,
  episodeLabel,
  hue,
  progressPercent,
  shelfUrl,
  statusLabel,
} from '../../media/labels';
import { LocalSynopsisPipe, LocalTitlePipe, localTitle } from '../../media/local-title';
import { MediaApi, errorMessage } from '../../media/media-api';
import { BookSeries, EntryDetail, EntryUpdate, QuickAction, Session } from '../../media/models';
import { Poster } from '../../ui/poster';
import { StarRating } from '../../ui/star-rating';

interface StatusButton {
  action: QuickAction;
  /** Finish with the date unknown. */
  undated?: boolean;
  label: string;
  icon?: IconName;
  style: '' | 'soft' | 'ghost';
}

@Component({
  selector: 'ab-entry',
  imports: [
    Icon,
    DatePipe,
    FormsModule,
    RouterLink,
    Poster,
    StarRating,
    TranslatePipe,
    LocalTitlePipe,
    LocalSynopsisPipe,
  ],
  templateUrl: './entry.html',
})
export class EntryPage {
  private readonly api = inject(MediaApi);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly translate = inject(TranslateService);
  protected readonly lang = inject(LanguageService).current;

  /** Route param. */
  readonly id = input.required<string>();

  protected readonly entry = signal<EntryDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly notes = signal('');
  protected readonly notesSaved = signal(false);
  protected readonly newStart = signal('');
  protected readonly newFinish = signal('');
  /** Books: the user's series, for the Series panel's select. */
  protected readonly allSeries = signal<BookSeries[]>([]);

  protected readonly icon = TYPE_ICON;
  protected readonly typeLabel = TYPE_LABEL;
  protected readonly shelfUrl = shelfUrl;
  protected readonly statusLabel = statusLabel;

  /** The other-language and original titles, when they differ from the one shown. */
  protected readonly otherTitles = computed(() => {
    const item = this.entry()?.item;
    if (!item) return [];
    const shown = localTitle(item, this.lang());
    const others = [item.title, item.title_fr, item.original_title].filter(
      (t): t is string => !!t && t.toLowerCase() !== shown.toLowerCase(),
    );
    return [...new Set(others)];
  });
  protected readonly hue = computed(() => {
    const e = this.entry();
    return e ? hue(e.item) : 0;
  });
  protected readonly episode = computed(() => {
    const e = this.entry();
    return e ? episodeLabel(e) : null;
  });
  protected readonly percent = computed(() => {
    const e = this.entry();
    return e ? progressPercent(e) : null;
  });
  protected readonly seasonCount = computed(() => {
    const e = this.entry();
    const counts = e?.item.season_episode_counts;
    if (!e || !counts || e.current_season === null) return null;
    return counts[e.current_season - 1] ?? null;
  });

  protected readonly buttons = computed((): StatusButton[] => {
    const e = this.entry();
    if (!e) return [];
    const book = e.item.type === 'book';
    const series = e.item.type === 'series';
    switch (e.status) {
      case 'want':
        return [
          {
            action: 'start',
            label: book ? 'action.startReading' : 'action.start',
            icon: 'play',
            style: '',
          },
          {
            action: 'finish',
            label: book ? 'action.readToday' : 'action.watchedToday',
            icon: 'check',
            style: 'soft',
          },
          {
            action: 'finish',
            undated: true,
            label: book ? 'action.readUndated' : 'action.watchedUndated',
            icon: 'check',
            style: 'soft',
          },
          { action: 'drop', label: 'action.notForMe', style: 'ghost' },
        ];
      case 'in_progress': {
        const next: StatusButton[] =
          series && !e.at_last_known_episode
            ? [{ action: 'next-episode', label: 'action.nextEpisode', style: '' }]
            : [];
        return [
          ...next,
          {
            action: 'finish',
            label: 'action.finish',
            icon: 'check',
            style: next.length ? 'soft' : '',
          },
          { action: 'drop', label: 'action.drop', style: 'ghost' },
        ];
      }
      case 'done':
        return [
          {
            action: 'start',
            label: book ? 'action.readAgain' : 'action.watchAgain',
            icon: 'again',
            style: '',
          },
        ];
      case 'dropped':
        return [
          { action: 'start', label: 'action.resume', icon: 'play', style: '' },
          { action: 'finish', label: 'action.finish', icon: 'check', style: 'soft' },
        ];
    }
  });

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.entry.set(null);
      this.run(() => this.api.entry(id)).then((ok) => {
        if (ok && this.entry()?.item.type === 'book') this.loadSeries();
      });
    });
    // The tab shows the title in the current language, also after a switch.
    effect(() => {
      const item = this.entry()?.item;
      if (item) this.title.setTitle(`${localTitle(item, this.lang())} · Media`);
    });
  }

  private async run(request: () => Promise<EntryDetail>): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const entry = await request();
      this.entry.set(entry);
      this.notes.set(entry.notes ?? '');
      return true;
    } catch (e) {
      this.error.set(httpStatus(e) === 404 ? 'entry.notFound' : errorMessage(e));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private update(changes: EntryUpdate): Promise<boolean> {
    const id = this.entry()!.id;
    return this.run(() => this.api.update(id, changes));
  }

  protected act(button: StatusButton): void {
    const id = this.entry()!.id;
    this.run(() => this.api.act(id, button.action, button.undated));
  }

  private loadSeries(): void {
    this.api.allSeries().then(
      (list) => this.allSeries.set(list),
      () => {},
    );
  }

  /** The select's value: a series id, '' for none, or 'new' (asks for a name). */
  protected async setSeries(value: string, select: HTMLSelectElement): Promise<void> {
    const e = this.entry()!;
    if (value === 'new') {
      const name = prompt(this.translate.instant('entry.newSeriesPrompt'))?.trim();
      if (!name) {
        select.value = e.series_id === null ? '' : String(e.series_id);
        return;
      }
      try {
        const created = await this.api.createSeries(name);
        this.allSeries.update((list) => [...list, created]);
        value = String(created.id);
      } catch (err) {
        this.error.set(errorMessage(err));
        select.value = e.series_id === null ? '' : String(e.series_id);
        return;
      }
    }
    const seriesId = value === '' ? null : Number(value);
    if (seriesId === e.series_id) return;
    if (await this.update({ series_id: seriesId })) this.loadSeries();
  }

  protected saveVolume(value: string): void {
    const volume = value.trim() === '' ? null : Number(value);
    if (volume !== null && (!Number.isInteger(volume) || volume < 0 || volume > 9999)) {
      this.error.set('entry.errorVolume');
      return;
    }
    if (volume === this.entry()!.series_volume) return;
    this.update({ series_volume: volume });
  }

  protected rate(rating: number | null): void {
    this.update({ rating });
  }

  protected async saveNotes(): Promise<void> {
    const notes = this.notes().trim();
    if (notes === (this.entry()!.notes ?? '')) return;
    if (await this.update({ notes: notes || null })) {
      this.notesSaved.set(true);
      setTimeout(() => this.notesSaved.set(false), 2000);
    }
  }

  protected toggleOwned(): void {
    this.update({ owned: !this.entry()!.owned });
  }

  protected saveProgress(season: string, episode: string): void {
    const s = Number(season);
    const ep = Number(episode);
    if (!Number.isInteger(s) || s < 1 || !Number.isInteger(ep) || ep < 0) {
      this.error.set('entry.errorProgress');
      return;
    }
    const e = this.entry()!;
    if (s === e.current_season && ep === e.current_episode) return;
    this.update({ current_season: s, current_episode: ep });
  }

  /** Checked here too so the message is in the UI language (ISO dates compare as strings). */
  private finishesBeforeStart(started: string, finished: string): boolean {
    if (started && finished && finished < started) {
      this.error.set('entry.errorSessionOrder');
      return true;
    }
    return false;
  }

  protected saveSession(session: Session, started: string, finished: string): void {
    if (this.finishesBeforeStart(started, finished)) return;
    const id = this.entry()!.id;
    this.run(() =>
      this.api.updateSession(id, session.id, {
        started_on: started || null,
        finished_on: finished || null,
        // A finish date makes it a dated read (the server clears it too).
        undated: session.undated && !finished,
      }),
    );
  }

  protected deleteSession(session: Session): void {
    if (!confirm(this.translate.instant('entry.confirmDeleteSession'))) return;
    const id = this.entry()!.id;
    this.run(() => this.api.deleteSession(id, session.id));
  }

  protected async addSession(): Promise<void> {
    if (this.finishesBeforeStart(this.newStart(), this.newFinish())) return;
    const id = this.entry()!.id;
    const ok = await this.run(() =>
      this.api.addSession(id, {
        started_on: this.newStart() || null,
        finished_on: this.newFinish() || null,
      }),
    );
    if (ok) {
      this.newStart.set('');
      this.newFinish.set('');
    }
  }

  protected addUndatedSession(): void {
    const id = this.entry()!.id;
    this.run(() => this.api.addSession(id, { started_on: null, finished_on: null, undated: true }));
  }

  protected async remove(): Promise<void> {
    const e = this.entry()!;
    if (
      !confirm(
        this.translate.instant('entry.confirmRemove', { title: localTitle(e.item, this.lang()) }),
      )
    )
      return;
    try {
      await this.api.remove(e.id);
      this.router.navigate([shelfUrl(e.item.type)]);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}
