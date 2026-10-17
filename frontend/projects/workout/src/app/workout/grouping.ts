// Grouping of the workouts list by year / month / ISO week.

import { parseDate } from './format';
import { Workout } from './models';

export type Level = 'year' | 'month' | 'week';
export const LEVELS: Level[] = ['year', 'month', 'week'];

export type ListRow =
  | { kind: 'group'; key: string; label: string; depth: number; count: number; collapsed: boolean }
  | { kind: 'workout'; workout: Workout; depth: number };

/** The Monday of the ISO week and its ISO year/number. */
function isoWeek(d: Date): { monday: Date; year: number; week: number } {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  const thursday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3);
  const jan1 = new Date(thursday.getFullYear(), 0, 1);
  const week = Math.floor((thursday.getTime() - jan1.getTime()) / 86_400_000 / 7) + 1;
  return { monday, year: thursday.getFullYear(), week };
}

export function groupKey(date: string, level: Level, lang: string): { key: string; label: string } {
  const d = parseDate(date);
  if (level === 'year') return { key: String(d.getFullYear()), label: String(d.getFullYear()) };
  if (level === 'month') {
    return {
      key: date.slice(0, 7),
      label: d.toLocaleDateString(lang, { month: 'long', year: 'numeric' }),
    };
  }
  const { monday, year, week } = isoWeek(d);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const fmt = (x: Date) => x.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
  return {
    key: `${year}-W${String(week).padStart(2, '0')}`,
    label: `${fmt(monday)} – ${fmt(sunday)} ${year}`,
  };
}

/**
 * Flat rows to render: a header per group (nested by the active levels, in
 * year → month → week order) followed by its workouts, unless collapsed.
 * Workouts come newest first and keep that order.
 */
export function listRows(
  workouts: Workout[],
  levels: Set<Level>,
  collapsed: Set<string>,
  lang: string,
): ListRow[] {
  const active = LEVELS.filter((l) => levels.has(l));
  const rows: ListRow[] = [];
  const walk = (items: Workout[], depth: number, prefix: string) => {
    const level = active[depth];
    if (!level) {
      for (const workout of items) rows.push({ kind: 'workout', workout, depth });
      return;
    }
    const groups = new Map<string, { label: string; items: Workout[] }>();
    for (const w of items) {
      const { key, label } = groupKey(w.date!, level, lang);
      const full = `${prefix}${key}`;
      if (!groups.has(full)) groups.set(full, { label, items: [] });
      groups.get(full)!.items.push(w);
    }
    for (const [key, g] of groups) {
      const isCollapsed = collapsed.has(key);
      rows.push({ kind: 'group', key, label: g.label, depth, count: g.items.length, collapsed: isCollapsed });
      if (!isCollapsed) walk(g.items, depth + 1, `${key}/`);
    }
  };
  walk(workouts, 0, '');
  return rows;
}
