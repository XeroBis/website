// JSON files for import/export: download, read, and a shape check run before
// sending (so the user gets the path of the first problem). The backend
// checks again; this only catches files of the wrong kind early.

export type FileShape =
  | 'workouts'
  | 'templates'
  | 'circuits'
  | 'userWorkouts'
  | 'userTemplates'
  | 'exercises'
  | 'equipments';

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** The parsed file, or throws `SyntaxError` for invalid JSON. */
export async function readJson(file: File): Promise<unknown> {
  return JSON.parse(await file.text());
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function checkMember(e: unknown, at: string): string | null {
  if (!isObj(e)) return `${at}: not an object`;
  if (typeof e['exercise_name'] !== 'string') return `${at}: missing "exercise_name"`;
  const legacyCardio =
    e['type'] === 'cardio' && (typeof e['intervals'] === 'number' || typeof e['duration_s'] === 'number');
  if (!Array.isArray(e['sets']) && !legacyCardio) return `${at}: missing "sets"`;
  return null;
}

function checkEntry(e: unknown, at: string): string | null {
  if (!isObj(e)) return `${at}: not an object`;
  if (e['type'] === 'circuit') {
    if (!Array.isArray(e['exercises'])) return `${at}: circuit without "exercises"`;
    return firstError(e['exercises'], `${at}.exercises`, checkMember);
  }
  if (!['exercise', 'strength', 'cardio'].includes(e['type'] as string))
    return `${at}: "type" must be exercise, circuit, strength or cardio`;
  return checkMember(e, at);
}

function checkEntries(o: Obj, at: string): string | null {
  if (!Array.isArray(o['exercises'])) return `${at}: missing "exercises"`;
  return firstError(o['exercises'], `${at}.exercises`, checkEntry);
}

function checkWorkout(w: unknown, at: string): string | null {
  if (!isObj(w)) return `${at}: not an object`;
  if (typeof w['date'] !== 'string') return `${at}: missing "date"`;
  if (typeof w['duration_minutes'] !== 'number') return `${at}: missing "duration_minutes"`;
  return checkEntries(w, at);
}

function checkNamed(t: unknown, at: string): string | null {
  if (!isObj(t)) return `${at}: not an object`;
  if (typeof t['name'] !== 'string') return `${at}: missing "name"`;
  return null;
}

function checkTemplate(t: unknown, at: string): string | null {
  return checkNamed(t, at) ?? checkEntries(t as Obj, at);
}

function checkCircuit(c: unknown, at: string): string | null {
  const err = checkNamed(c, at);
  if (err) return err;
  const o = c as Obj;
  if (!Array.isArray(o['exercises'])) return `${at}: missing "exercises"`;
  return firstError(o['exercises'], `${at}.exercises`, checkMember);
}

function checkExercise(e: unknown, at: string): string | null {
  const err = checkNamed(e, at);
  if (err) return err;
  const o = e as Obj;
  if (o['type'] !== 'strength' && o['type'] !== 'cardio') return `${at}: "type" must be strength or cardio`;
  if (o['muscles'] !== undefined && !Array.isArray(o['muscles'])) return `${at}: "muscles" must be a list`;
  if (o['equipments'] !== undefined && !Array.isArray(o['equipments']))
    return `${at}: "equipments" must be a list`;
  return null;
}

function perUser(key: 'workouts' | 'templates', check: typeof checkWorkout) {
  return (u: unknown, at: string): string | null => {
    if (!isObj(u)) return `${at}: not an object`;
    if (typeof u['user_email'] !== 'string') return `${at}: missing "user_email"`;
    if (!Array.isArray(u[key])) return `${at}: missing "${key}"`;
    return firstError(u[key], `${at}.${key}`, check);
  };
}

function firstError(
  items: unknown[],
  at: string,
  check: (item: unknown, at: string) => string | null,
): string | null {
  for (let i = 0; i < items.length; i++) {
    const err = check(items[i], `${at}[${i}]`);
    if (err) return err;
  }
  return null;
}

const CHECKS: Record<FileShape, (item: unknown, at: string) => string | null> = {
  workouts: checkWorkout,
  templates: checkTemplate,
  circuits: checkCircuit,
  userWorkouts: perUser('workouts', checkWorkout),
  userTemplates: perUser('templates', checkTemplate),
  exercises: checkExercise,
  equipments: (v, at) => (typeof v === 'string' ? null : `${at}: not a name`),
};

/** The first problem of a parsed file (`[3].exercises[0]: missing "sets"`), or null. */
export function checkFile(data: unknown, shape: FileShape): string | null {
  if (!Array.isArray(data)) return 'not a list';
  return firstError(data, '', CHECKS[shape]);
}

/** Admin workout/template files: the old multi-user wrapper, else a plain list. */
export function isMultiUser(data: unknown): boolean {
  return Array.isArray(data) && isObj(data[0]) && typeof data[0]['user_email'] === 'string';
}
