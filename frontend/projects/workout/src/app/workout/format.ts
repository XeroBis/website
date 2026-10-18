import { Entry, ExerciseEntry, Equipment, MuscleIntensity, SetField, SetValues } from './models';

/** `1h 2min 3s`; `—` when unknown. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [h && `${h}h`, m && `${m}min`, s && `${s}s`].filter(Boolean);
  return parts.length ? parts.join(' ') : '0s';
}

/** Metres under 1 km, else km with up to two decimals. */
export function formatDistance(meters: number | null | undefined): string {
  if (meters == null) return '—';
  if (meters >= 1000) return `${Number((meters / 1000).toFixed(2))}km`;
  return `${meters}m`;
}

/** Elapsed time on a clock: `04:05`, or `1:04:05` past an hour. */
export function formatClock(seconds: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Volume: `850 kg`, `12.4 t`, `1.2 Mt`. */
export function formatVolume(kg: number): string {
  if (kg >= 1_000_000) return `${(kg / 1_000_000).toFixed(1)} Mt`;
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  return `${Math.round(kg)} kg`;
}

/**
 * The parts of a set, in display order, each a translation-free string
 * except the labels passed in (`reps`, `difficulty`): `12 reps @ 40 kg`, `1min 30s`…
 */
export function setParts(set: SetValues, labels: { reps: string; difficulty: string }): string[] {
  const parts: string[] = [];
  if (set.reps) parts.push(`${set.reps} ${labels.reps}${set.weight_kg ? ` @ ${set.weight_kg} kg` : ''}`);
  else if (set.weight_kg) parts.push(`${set.weight_kg} kg`);
  if (set.duration_s) parts.push(formatDuration(set.duration_s));
  if (set.speed_kmh) parts.push(`${set.speed_kmh} km/h`);
  if (set.difficulty) parts.push(`${labels.difficulty} ${set.difficulty}`);
  if (set.distance_m) parts.push(formatDistance(set.distance_m));
  return parts;
}

/** Every exercise of a list of entries, circuit members included. */
export function flatExercises(entries: Entry[]): ExerciseEntry[] {
  return entries.flatMap((e) => (e.type === 'circuit' ? e.exercises : [e]));
}

/** Summed muscle intensities, capped at 3, strongest first. */
export function aggregateMuscles(exercises: ExerciseEntry[]): MuscleIntensity[] {
  const totals = new Map<string, number>();
  for (const ex of exercises)
    for (const m of ex.exercise.muscles) totals.set(m.name, (totals.get(m.name) ?? 0) + m.intensity);
  return [...totals]
    .map(([name, sum]) => ({ name, intensity: Math.min(sum, 3) }))
    .sort((a, b) => b.intensity - a.intensity || a.name.localeCompare(b.name));
}

export function aggregateEquipments(exercises: ExerciseEntry[]): Equipment[] {
  const seen = new Map<number, Equipment>();
  for (const ex of exercises) for (const eq of ex.exercise.equipments) seen.set(eq.id, eq);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Fields shown by default: reps + weight for strength, duration + distance for cardio. */
export function defaultFields(type: 'strength' | 'cardio' | null | undefined): SetField[] {
  return type === 'cardio' ? ['duration_s', 'distance_m'] : ['reps', 'weight_kg'];
}

/** `YYYY-MM-DD` of a local date (not toISOString, which is UTC). */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Every word of `query` appears in the template's name, circuit names or exercise names. */
export function matchesTemplate(template: { name: string; exercises: Entry[] }, query: string): boolean {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const names = template.exercises.flatMap((e) =>
    e.type === 'exercise' ? [e.exercise.name] : [e.name ?? '', ...e.exercises.map((x) => x.exercise.name)],
  );
  const haystack = [template.name, ...names].join(' ').toLowerCase();
  return words.every((w) => haystack.includes(w));
}

/** Every word of `query` appears in the exercise's name or muscles. */
export function matchesExercise(
  exercise: { name: string; muscles: MuscleIntensity[] },
  query: string,
): boolean {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const haystack = [exercise.name, ...exercise.muscles.map((m) => m.name)].join(' ').toLowerCase();
  return words.every((w) => haystack.includes(w));
}
