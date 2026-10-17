import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, linkedSignal, resource, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { LanguageService } from '@shared';

import { ViewingSelect } from '../../ui/viewing-select';
import { MuscleMap } from '../../ui/muscle-map';
import { WorkoutApi, errorMessage } from '../../workout/api';
import { PRESETS, Preset, calendar, muscleShades, niceMax, presetRange } from '../../workout/dashboard';
import { formatVolume, parseDate } from '../../workout/format';
import { Viewing } from '../../workout/viewing';

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
// Progression chart geometry (SVG units).
const P = { left: 44, step: 44, top: 12, height: 150, right: 24 };

/** Stats of a date range: totals, calendar, weekly charts, progression, top, weekdays, muscles. */
@Component({
  selector: 'ab-dashboard',
  imports: [DatePipe, DecimalPipe, MuscleMap, TranslatePipe, ViewingSelect],
  providers: [Viewing],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  private readonly api = inject(WorkoutApi);
  private readonly router = inject(Router);
  protected readonly viewing = inject(Viewing);
  protected readonly lang = inject(LanguageService).current;

  protected readonly presets = PRESETS;
  protected readonly weekdays = WEEKDAYS;
  protected readonly preset = signal<Preset | 'custom'>('3m');
  protected readonly from = signal(presetRange('3m').from);
  protected readonly to = signal(presetRange('3m').to);

  protected readonly stats = resource({
    params: () => ({ user_id: this.viewing.queryUserId(), date_from: this.from(), date_to: this.to() }),
    loader: ({ params }) => this.api.stats(params),
  });
  protected readonly error = computed(() => (this.stats.error() ? errorMessage(this.stats.error()) : null));

  protected readonly months = computed(() => (this.stats.value() ? calendar(this.stats.value()!) : []));
  protected readonly weeks = computed(() => {
    const weeks = this.stats.value()?.weeks ?? [];
    const maxCount = niceMax(Math.max(4, ...weeks.map((w) => w.workouts)));
    const maxVolume = niceMax(Math.max(1, ...weeks.map((w) => w.volume_kg)));
    return {
      maxCount,
      maxVolume,
      bars: weeks.map((w, i) => ({
        ...w,
        countPct: (w.workouts / maxCount) * 100,
        volumePct: (w.volume_kg / maxVolume) * 100,
        // A year label above the first week of each new year.
        year: i > 0 && w.week_start.slice(0, 4) !== weeks[i - 1].week_start.slice(0, 4) ? w.week_start.slice(0, 4) : null,
      })),
    };
  });
  protected readonly top = computed(() => {
    const top = (this.stats.value()?.top_exercises ?? []).slice(0, 10);
    return top.map((t) => ({ ...t, pct: (t.count / (top[0]?.count || 1)) * 100 }));
  });
  protected readonly weekdayBars = computed(() => {
    const counts = this.stats.value()?.weekdays ?? [0, 0, 0, 0, 0, 0, 0];
    const max = Math.max(1, ...counts);
    return counts.map((count, i) => ({ key: WEEKDAYS[i], count, pct: (count / max) * 100 }));
  });
  protected readonly shades = computed(() =>
    this.stats.value() ? muscleShades(this.stats.value()!) : { muscles: [], exercises: {} },
  );

  // ── progression ──
  // The picked exercise, kept when the range changes if it still has points.
  protected readonly progressionId = linkedSignal<
    { exercise_id: number }[],
    number | null
  >({
    source: () => this.stats.value()?.progression ?? [],
    computation: (list, previous) =>
      list.find((p) => p.exercise_id === previous?.value)?.exercise_id ??
      list[0]?.exercise_id ??
      null,
  });
  protected readonly chart = computed(() => {
    const series = this.stats.value()?.progression.find((p) => p.exercise_id === this.progressionId());
    const points = series?.points ?? [];
    const max = niceMax(Math.max(1, ...points.map((p) => p.est_1rm_kg)));
    const x = (i: number) => P.left + P.step / 2 + i * P.step;
    const y = (v: number) => P.top + P.height - (v / max) * P.height;
    const line = (key: 'max_weight_kg' | 'est_1rm_kg') =>
      points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[key])}`).join(' ');
    const every = Math.max(1, Math.ceil(points.length / 7));
    return {
      points: points.map((p, i) => ({
        ...p,
        x: x(i),
        yWeight: y(p.max_weight_kg),
        y1rm: y(p.est_1rm_kg),
        label: i % every === 0 || i === points.length - 1,
      })),
      width: Math.max(320, P.left + P.step * Math.max(points.length, 6) + P.right),
      height: P.top + P.height + 28,
      baseline: P.top + P.height,
      ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => ({ value: max * f, y: y(max * f) })),
      weightPath: line('max_weight_kg'),
      oneRmPath: line('est_1rm_kg'),
    };
  });
  protected readonly hovered = signal<number | null>(null);

  protected readonly formatVolume = formatVolume;

  protected applyPreset(preset: Preset): void {
    const range = presetRange(preset);
    this.preset.set(preset);
    this.from.set(range.from);
    this.to.set(range.to);
  }

  protected setDate(which: 'from' | 'to', value: string): void {
    this.preset.set('custom');
    (which === 'from' ? this.from : this.to).set(value);
  }

  protected openDay(ids: number[]): void {
    if (!ids.length) return;
    this.router.navigate(['/workouts'], {
      queryParams: { user: this.viewing.queryUserId() },
      state: { scrollTo: ids[0] },
    });
  }

  protected monthDate(year: number, month: number): Date {
    return new Date(year, month, 1);
  }

  protected weekDate(day: string): Date {
    return parseDate(day);
  }

  /** Nearest progression point to the pointer, for the crosshair. */
  protected hover(event: MouseEvent, svg: Element): void {
    const points = this.chart().points;
    if (!points.length) return;
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * this.chart().width;
    let best = 0;
    for (let i = 1; i < points.length; i++)
      if (Math.abs(points[i].x - x) < Math.abs(points[best].x - x)) best = i;
    this.hovered.set(best);
  }
}
