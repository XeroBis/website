// Shapes of `/api/workout` (see documentation/features.md "Workout").

export type ExerciseType = 'strength' | 'cardio';

export interface MuscleIntensity {
  name: string;
  intensity: number;
}

export interface Equipment {
  id: number;
  name: string;
}

export interface Exercise {
  id: number;
  name: string;
  type: ExerciseType;
  muscles: MuscleIntensity[];
  equipments: Equipment[];
}

export interface ExerciseInput {
  name: string;
  type: ExerciseType;
  muscles: MuscleIntensity[];
  equipments: string[];
}

export const SET_FIELDS = [
  'reps',
  'weight_kg',
  'duration_s',
  'distance_m',
  'speed_kmh',
  'difficulty',
] as const;
export type SetField = (typeof SET_FIELDS)[number];
export type SetValues = Partial<Record<SetField, number | null>>;

export interface WorkoutSet extends Record<SetField, number | null> {
  id: number;
}

export interface ExerciseEntry {
  id: number;
  type: 'exercise';
  exercise_id: number;
  exercise: Exercise;
  sets: WorkoutSet[];
}

export interface CircuitEntry {
  id: number;
  type: 'circuit';
  name: string | null;
  duration_minutes: number | null;
  rounds: number | null;
  exercises: ExerciseEntry[];
}

export type Entry = ExerciseEntry | CircuitEntry;

export interface Workout {
  id: number;
  user_id: number;
  status: 'in_progress' | 'completed';
  date: string | null;
  duration_minutes: number | null;
  started_at: string | null;
  ended_at: string | null;
  exercises: Entry[];
}

export interface Template {
  id: number;
  user_id: number;
  name: string;
  exercises: Entry[];
}

export interface SavedCircuit {
  id: number;
  type: 'circuit';
  name: string;
  duration_minutes: number | null;
  rounds: number | null;
  exercises: ExerciseEntry[];
}

export interface MemberInput {
  exercise_id: number;
  sets: SetValues[];
}

export type EntryInput =
  | ({ type: 'exercise' } & MemberInput)
  | {
      type: 'circuit';
      name: string | null;
      duration_minutes: number | null;
      rounds: number | null;
      exercises: MemberInput[];
    };

export interface WorkoutInput {
  date: string;
  duration_minutes: number;
  exercises: EntryInput[];
}

export interface TemplateInput {
  name: string;
  exercises: EntryInput[];
}

export interface SavedCircuitInput {
  name: string;
  duration_minutes: number | null;
  rounds: number | null;
  exercises: MemberInput[];
}

export interface WorkoutUser {
  id: number;
  pseudo: string;
}

export interface NameCount {
  name: string;
  count: number;
}

export interface Stats {
  date_from: string | null;
  date_to: string | null;
  workouts: number;
  exercises: number;
  volume_kg: number;
  days: { date: string; workout_ids: number[] }[];
  weeks: { week_start: string; workouts: number; volume_kg: number }[];
  weekdays: number[];
  top_exercises: NameCount[];
  muscles: { name: string; total: number; exercises: NameCount[] }[];
  progression: {
    exercise_id: number;
    name: string;
    points: { date: string; max_weight_kg: number; est_1rm_kg: number }[];
  }[];
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  ignored: string[];
}

export interface WorkoutFilters {
  user_id?: number | null;
  date_from?: string | null;
  date_to?: string | null;
  exercise_id?: number | null;
  limit?: number;
  offset?: number;
}
