import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  resource,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon, LanguageService } from '@shared';

import { DetailsModal } from '../../ui/details-modal';
import { EntryList } from '../../ui/entry-list';
import { ExercisePicker } from '../../ui/exercise-picker';
import { HistoryModal } from '../../ui/history-modal';
import { Menu } from '../../ui/menu';
import { ViewingSelect } from '../../ui/viewing-select';
import { WorkoutApi, errorMessage } from '../../workout/api';
import { entryNames } from '../../workout/format';
import { LEVELS, Level, listRows } from '../../workout/grouping';
import { Exercise, Workout, WorkoutFilters } from '../../workout/models';
import { Viewing } from '../../workout/viewing';
import { SaveTemplateModal } from './save-template-modal';

const PAGE = 20;
/** How long a deleted workout can be brought back. */
const UNDO_MS = 6000;

type Filters = Required<Pick<WorkoutFilters, 'exercise_id' | 'date_from' | 'date_to'>>;

/** Newest first, like the API. */
function newestFirst(a: Workout, b: Workout): number {
  return (b.date ?? '').localeCompare(a.date ?? '') || b.id - a.id;
}

/**
 * Completed workouts, newest first, grouped, with infinite scroll. Filtered
 * by exercise and dates from the URL; cards collapsed to a summary.
 */
@Component({
  selector: 'ab-workouts',
  imports: [
    DatePipe,
    DetailsModal,
    EntryList,
    ExercisePicker,
    HistoryModal,
    Icon,
    Menu,
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
  private readonly router = inject(Router);
  protected readonly viewing = inject(Viewing);
  protected readonly lang = inject(LanguageService).current;

  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);
  protected readonly filters = computed<Filters>(
    () => {
      const q = this.query();
      return {
        exercise_id: Number(q?.get('exercise')) || null,
        date_from: q?.get('from') || null,
        date_to: q?.get('to') || null,
      };
    },
    {
      equal: (a, b) =>
        a.exercise_id === b.exercise_id && a.date_from === b.date_from && a.date_to === b.date_to,
    },
  );
  protected readonly filtered = computed(() => Object.values(this.filters()).some((v) => v));
  /** The filters row: open when the URL already filters, off clears the filters. */
  protected readonly showFilters = signal(untracked(this.filtered));
  protected readonly catalog = resource({ loader: () => this.api.exercises() });
  protected readonly filterExercise = computed(
    () => this.catalog.value()?.find((e) => e.id === this.filters().exercise_id) ?? null,
  );

  protected readonly workouts = signal<Workout[]>([]);
  protected readonly loading = signal(true);
  protected readonly hasMore = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly levelList = LEVELS;
  protected readonly levels = signal(new Set<Level>(['month']));
  protected readonly collapsed = signal(new Set<string>());
  /** Deleted, waiting for Undo: hidden, still on the server. */
  protected readonly deleting = signal<Workout | null>(null);
  private deleteTimer: ReturnType<typeof setTimeout> | undefined;
  /** An action's failure, in the bottom bar (the list may be scrolled far from the top). */
  protected readonly notice = signal<string | null>(null);
  protected readonly rows = computed(() => {
    const hidden = this.deleting()?.id;
    const shown = this.workouts().filter((w) => w.id !== hidden);
    return listRows(shown, this.levels(), this.collapsed(), this.lang());
  });
  /** Opened cards; the others show a one-line summary. */
  protected readonly expanded = signal(new Set<number>());
  protected readonly entryNames = entryNames;

  protected readonly details = signal<Workout | null>(null);
  protected readonly history = signal<Exercise | null>(null);
  protected readonly saveAsTemplate = signal<Workout | null>(null);

  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  /** From the dashboard's calendar: a workout to scroll to once loaded. */
  private scrollTo: number | null = window.history.state?.scrollTo ?? null;
  private generation = 0;

  constructor() {
    // Reload from the start whenever the viewed user or the filters change.
    effect(() => {
      const user = this.viewing.queryUserId();
      const filters = this.filters();
      untracked(() => this.reload(user, filters));
    });
    if (this.scrollTo !== null) this.expanded.set(new Set([this.scrollTo]));
    // Leaving with a delete pending: it goes through, as if the bar had timed out.
    const onPageHide = () => {
      const w = this.deleting();
      if (w) this.api.deleteWorkoutOnUnload(w.id);
    };
    window.addEventListener('pagehide', onPageHide);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('pagehide', onPageHide);
      this.commitDelete();
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

  private async reload(user: number | null, filters: Filters): Promise<void> {
    const generation = ++this.generation;
    this.loading.set(true);
    this.workouts.set([]);
    try {
      const page = await this.api.workouts({ ...filters, user_id: user, limit: PAGE, offset: 0 });
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
        ...this.filters(),
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

  protected setFilter(key: 'exercise' | 'from' | 'to', value: string | number | null): void {
    this.router.navigate([], {
      queryParams: { [key]: value || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected toggleFilters(): void {
    if (this.showFilters()) this.clearFilters();
    this.showFilters.update((on) => !on);
  }

  protected clearFilters(): void {
    this.router.navigate([], {
      queryParams: { exercise: null, from: null, to: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected toggleCard(id: number): void {
    const next = new Set(this.expanded());
    if (!next.delete(id)) next.add(id);
    this.expanded.set(next);
  }

  protected async repeat(workout: Workout): Promise<void> {
    try {
      await this.api.startSession({ workout_id: workout.id, user_id: this.viewing.queryUserId() });
      await this.router.navigateByUrl('/session');
    } catch (e) {
      this.notice.set(errorMessage(e));
    }
  }

  /** Hide the card and offer Undo; the server delete waits for the bar to go. */
  protected remove(workout: Workout): void {
    this.commitDelete();
    this.notice.set(null);
    this.deleting.set(workout);
    this.deleteTimer = setTimeout(() => this.commitDelete(), UNDO_MS);
    this.fillScreen();
  }

  protected undo(): void {
    clearTimeout(this.deleteTimer);
    this.deleting.set(null);
  }

  private async commitDelete(): Promise<void> {
    const workout = this.deleting();
    if (!workout) return;
    clearTimeout(this.deleteTimer);
    this.deleting.set(null);
    this.workouts.update((list) => list.filter((w) => w.id !== workout.id));
    try {
      await this.api.deleteWorkout(workout.id);
    } catch (e) {
      // Still there: put it back.
      this.workouts.update((list) => [...list, workout].sort(newestFirst));
      this.notice.set(errorMessage(e));
    }
  }
}
