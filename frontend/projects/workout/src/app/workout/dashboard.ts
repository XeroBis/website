// Dashboard layout helpers: ranges, calendar grid, chart scales. The numbers
// themselves come from `GET /api/workout/stats`.

import { isoDate, parseDate } from './format';
import { MuscleIntensity, NameCount, Stats } from './models';

export type Preset = '1m' | '3m' | '6m' | '1y' | 'all';
export const PRESETS: Preset[] = ['1m', '3m', '6m', '1y', 'all'];

/** Whole calendar months ending with the current one; `all` = no bounds. */
export function presetRange(preset: Preset, today = new Date()): { from: string; to: string } {
  if (preset === 'all') return { from: '', to: '' };
  const months = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 }[preset];
  const from = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1);
  const to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { from: isoDate(from), to: isoDate(to) };
}

export interface CalendarDay {
  date: string;
  day: number;
  inMonth: boolean;
  inRange: boolean;
  workoutIds: number[];
}

export interface CalendarMonth {
  year: number;
  month: number; // 0-11
  weeks: CalendarDay[][];
}

/** One grid per month of the range, Monday first, padded with the neighbours' days. */
export function calendar(stats: Stats): CalendarMonth[] {
  if (!stats.date_from || !stats.date_to) return [];
  const from = parseDate(stats.date_from);
  const to = parseDate(stats.date_to);
  const ids = new Map(stats.days.map((d) => [d.date, d.workout_ids]));
  const months: CalendarMonth[] = [];
  for (let m = new Date(from.getFullYear(), from.getMonth(), 1); m <= to; m.setMonth(m.getMonth() + 1)) {
    const year = m.getFullYear();
    const month = m.getMonth();
    const offset = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
    const days: CalendarDay[] = [];
    const count = Math.ceil((offset + new Date(year, month + 1, 0).getDate()) / 7) * 7;
    for (let i = 0; i < count; i++) {
      const d = new Date(year, month, 1 - offset + i);
      const date = isoDate(d);
      days.push({
        date,
        day: d.getDate(),
        inMonth: d.getMonth() === month,
        inRange: d >= from && d <= to,
        workoutIds: ids.get(date) ?? [],
      });
    }
    const weeks: CalendarDay[][] = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    months.push({ year, month, weeks });
  }
  return months;
}

/** A "nice" axis maximum (1, 2, 2.5, 5 × 10ⁿ) at or above `value`. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const f of [1, 2, 2.5, 5, 10]) if (f * step >= value) return f * step;
  return 10 * step;
}

/** Muscle totals scaled to 1–3 against the most worked one, for the body map. */
export function muscleShades(stats: Stats): {
  muscles: MuscleIntensity[];
  exercises: Record<string, NameCount[]>;
} {
  const max = Math.max(0, ...stats.muscles.map((m) => m.total));
  return {
    muscles: stats.muscles.map((m) => ({
      name: m.name,
      intensity: Math.max(1, Math.round((m.total / max) * 3)),
    })),
    exercises: Object.fromEntries(stats.muscles.map((m) => [m.name, m.exercises])),
  };
}
