// The entries editor's model: editable rows built from / turned into entries.

import {
  Entry,
  EntryInput,
  Exercise,
  ExerciseEntry,
  MemberInput,
  SET_FIELDS,
  SavedCircuit,
  SetValues,
} from './models';

let nextKey = 1;

export interface ExerciseRow {
  kind: 'exercise';
  key: number;
  exercise: Exercise | null;
  sets: SetValues[];
  allFields: boolean;
}

export interface CircuitRow {
  kind: 'circuit';
  key: number;
  name: string;
  duration_minutes: number | null;
  rounds: number | null;
  rows: ExerciseRow[];
}

export type Row = ExerciseRow | CircuitRow;

export function blankExercise(): ExerciseRow {
  return { kind: 'exercise', key: nextKey++, exercise: null, sets: [{}], allFields: false };
}

export function blankCircuit(): CircuitRow {
  return {
    kind: 'circuit',
    key: nextKey++,
    name: '',
    duration_minutes: null,
    rounds: null,
    rows: [blankExercise()],
  };
}

/** A set's values only (no id), for editing. */
export function setValues(set: SetValues): SetValues {
  const out: SetValues = {};
  for (const f of SET_FIELDS) if (set[f] != null) out[f] = set[f];
  return out;
}

function exerciseRow(e: ExerciseEntry): ExerciseRow {
  return {
    kind: 'exercise',
    key: nextKey++,
    exercise: e.exercise,
    sets: e.sets.length ? e.sets.map(setValues) : [{}],
    allFields: false,
  };
}

export function circuitRow(c: {
  name: string | null;
  duration_minutes: number | null;
  rounds: number | null;
  exercises: ExerciseEntry[];
}): CircuitRow {
  return {
    kind: 'circuit',
    key: nextKey++,
    name: c.name ?? '',
    duration_minutes: c.duration_minutes,
    rounds: c.rounds,
    rows: c.exercises.map(exerciseRow),
  };
}

export function rowsFromEntries(entries: Entry[]): Row[] {
  return entries.map((e) => (e.type === 'circuit' ? circuitRow(e) : exerciseRow(e)));
}

export function rowsFromSavedCircuit(c: SavedCircuit): ExerciseRow[] {
  return c.exercises.map(exerciseRow);
}

/** A translation key and its params, for the first problem found. */
export interface RowError {
  key: string;
  params?: Record<string, number>;
}

function cleanSet(set: SetValues): SetValues {
  const out: SetValues = {};
  for (const f of SET_FIELDS) {
    const v = set[f];
    if (v !== null && v !== undefined && !Number.isNaN(v)) out[f] = v;
  }
  return out;
}

/** Exercise rows (top-level and circuit members) are numbered 1, 2, … in order. */
function members(rows: ExerciseRow[], counter: { n: number }): MemberInput[] | RowError {
  const out: MemberInput[] = [];
  for (const row of rows) {
    counter.n++;
    if (!row.exercise) return { key: 'editor.errPick', params: { n: counter.n } };
    if (!row.sets.length) return { key: 'editor.errSets', params: { n: counter.n } };
    out.push({ exercise_id: row.exercise.id, sets: row.sets.map(cleanSet) });
  }
  return out;
}

/** The rows as API entries, or the first problem. */
export function toEntries(rows: Row[]): EntryInput[] | RowError {
  if (!rows.length) return { key: 'editor.errEmpty' };
  const counter = { n: 0 };
  const out: EntryInput[] = [];
  for (const row of rows) {
    if (row.kind === 'circuit') {
      if (!row.rows.length) return { key: 'editor.errEmptyCircuit' };
      const m = members(row.rows, counter);
      if (!Array.isArray(m)) return m;
      out.push({
        type: 'circuit',
        name: row.name.trim() || null,
        duration_minutes: row.duration_minutes || null,
        rounds: row.rounds || null,
        exercises: m,
      });
    } else {
      const m = members([row], counter);
      if (!Array.isArray(m)) return m;
      out.push({ type: 'exercise', ...m[0] });
    }
  }
  return out;
}

/** Same for a saved circuit's flat list. */
export function toMembers(rows: ExerciseRow[]): MemberInput[] | RowError {
  if (!rows.length) return { key: 'editor.errEmpty' };
  return members(rows, { n: 0 });
}

export function isRowError(v: unknown): v is RowError {
  return !Array.isArray(v);
}

export function move<T>(list: T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const copy = [...list];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}
