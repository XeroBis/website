import { DatePipe } from '@angular/common';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon, LanguageService } from '@shared';

import { ConfirmButton } from '../../ui/confirm-button';
import { DetailsModal } from '../../ui/details-modal';
import { EntryList } from '../../ui/entry-list';
import { HistoryModal } from '../../ui/history-modal';
import { ViewingSelect } from '../../ui/viewing-select';
import { WorkoutApi, errorMessage } from '../../workout/api';
import { LEVELS, Level, listRows } from '../../workout/grouping';
import { Exercise, Workout } from '../../workout/models';
import { Viewing } from '../../workout/viewing';
import { SaveTemplateModal } from './save-template-modal';

const PAGE = 20;

/** Completed workouts, newest first, grouped, with infinite scroll. */
@Component({
  selector: 'ab-workouts',
  imports: [
    ConfirmButton,
    DatePipe,
    DetailsModal,
    EntryList,
    HistoryModal,
    Icon,
    RouterLink,
    SaveTemplateModal,
    TranslatePipe,
    ViewingSelect,
  ],
  providers: [Viewing],
  templateUrl: './workouts.html',
})
export class Workouts {
  private readonly api = inject(WorkoutApi);
  private readonly injector = inject(Injector);
  protected readonly viewing = inject(Viewing);
  protected readonly lang = inject(LanguageService).current;

  protected readonly workouts = signal<Workout[]>([]);
  protected readonly loading = signal(true);
  protected readonly hasMore = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly levelList = LEVELS;
  protected readonly levels = signal(new Set<Level>(['month']));
  protected readonly collapsed = signal(new Set<string>());
  protected readonly rows = computed(() =>
    listRows(this.workouts(), this.levels(), this.collapsed(), this.lang()),
  );

  protected readonly details = signal<Workout | null>(null);
  protected readonly history = signal<Exercise | null>(null);
  protected readonly saveAsTemplate = signal<Workout | null>(null);

  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  /** From the dashboard's calendar: a workout to scroll to once loaded. */
  private scrollTo: number | null = window.history.state?.scrollTo ?? null;
  private generation = 0;

  constructor() {
    // Reload from the start whenever the viewed user changes.
    effect(() => {
      const user = this.viewing.queryUserId();
      untracked(() => this.reload(user));
    });
    afterNextRender(() => {
      const observer = new IntersectionObserver(
        (entries) => entries[0]?.isIntersecting && this.loadMore(),
        { rootMargin: '300px' },
      );
      const el = this.sentinel()?.nativeElement;
      if (el) observer.observe(el);
    });
  }

  private async reload(user: number | null): Promise<void> {
    const generation = ++this.generation;
    this.loading.set(true);
    this.workouts.set([]);
    try {
      const page = await this.api.workouts({ user_id: user, limit: PAGE, offset: 0 });
      if (generation !== this.generation) return;
      this.workouts.set(page);
      this.hasMore.set(page.length === PAGE);
      this.error.set(null);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
    this.afterLoad();
  }

  protected async loadMore(): Promise<void> {
    if (this.loading() || !this.hasMore()) return;
    const generation = this.generation;
    this.loading.set(true);
    try {
      const page = await this.api.workouts({
        user_id: this.viewing.queryUserId(),
        limit: PAGE,
        offset: this.workouts().length,
      });
      if (generation !== this.generation) return;
      this.workouts.update((list) => [...list, ...page]);
      this.hasMore.set(page.length === PAGE);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
    this.afterLoad();
  }

  /** Scroll to the requested workout, loading more pages until it's there. */
  private afterLoad(): void {
    this.fillScreen();
    if (this.scrollTo === null) return;
    setTimeout(() => {
      const el = document.getElementById(`workout-${this.scrollTo}`);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        this.scrollTo = null;
      } else if (this.hasMore()) {
        this.loadMore();
      }
    });
  }

  /**
   * Keep loading while the end of the list is on screen. The observer only
   * fires when the sentinel comes into view, so it misses the case where a
   * loaded page lands in a collapsed group and the sentinel never moves.
   */
  private fillScreen(): void {
    afterNextRender(
      {
        read: () => {
          const el = this.sentinel()?.nativeElement;
          if (el && el.getBoundingClientRect().top < window.innerHeight + 300) this.loadMore();
        },
      },
      { injector: this.injector },
    );
  }

  protected toggleLevel(level: Level): void {
    const next = new Set(this.levels());
    if (!next.delete(level)) next.add(level);
    this.levels.set(next);
    this.collapsed.set(new Set());
    this.fillScreen();
  }

  protected toggleGroup(key: string): void {
    const next = new Set(this.collapsed());
    if (!next.delete(key)) next.add(key);
    this.collapsed.set(next);
    this.fillScreen();
  }

  protected async remove(workout: Workout): Promise<void> {
    try {
      await this.api.deleteWorkout(workout.id);
      this.workouts.update((list) => list.filter((w) => w.id !== workout.id));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
