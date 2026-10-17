import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';

import {
  CircuitEntry,
  Equipment,
  Exercise,
  ExerciseEntry,
  ExerciseInput,
  ImportResult,
  SavedCircuit,
  SavedCircuitInput,
  SetValues,
  Stats,
  Template,
  TemplateInput,
  Workout,
  WorkoutFilters,
  WorkoutInput,
  WorkoutSet,
  WorkoutUser,
} from './models';

/** The backend's `detail` message, or a translation key for a generic one (show it through `| translate`). */
export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const detail = error.error?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail[0]?.msg)
      return String(detail[0].msg).replace(/^Value error, /, '');
    if (error.status === 0) return 'errors.unreachable';
  }
  return 'errors.generic';
}

const API = '/api/workout';

function params(values: object): HttpParams {
  let p = new HttpParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === '') continue;
    for (const v of Array.isArray(value) ? value : [value]) p = p.append(key, String(v));
  }
  return p;
}

/** The files of the import/export sections, by what they hold. */
export type FileKind = 'workouts' | 'templates' | 'circuits';
export type AdminFileKind = 'workouts' | 'templates' | 'exercises' | 'equipments';

@Injectable({ providedIn: 'root' })
export class WorkoutApi {
  private readonly http = inject(HttpClient);

  private run<T>(request: Observable<T>): Promise<T> {
    return firstValueFrom(request);
  }

  private get<T>(path: string, query: object = {}): Promise<T> {
    return this.run(this.http.get<T>(API + path, { params: params(query) }));
  }

  private post<T>(path: string, body: unknown = {}, query: object = {}): Promise<T> {
    return this.run(this.http.post<T>(API + path, body, { params: params(query) }));
  }

  private put<T>(path: string, body: unknown): Promise<T> {
    return this.run(this.http.put<T>(API + path, body));
  }

  private delete(path: string, query: object = {}): Promise<void> {
    return this.run(this.http.delete<void>(API + path, { params: params(query) }));
  }

  // ── people and catalog ──
  users = () => this.get<WorkoutUser[]>('/users');
  muscles = () => this.get<string[]>('/muscles');
  exercises = () => this.get<Exercise[]>('/exercises');
  exercise = (id: number) => this.get<Exercise>(`/exercises/${id}`);
  createExercise = (body: ExerciseInput) => this.post<Exercise>('/exercises', body);
  updateExercise = (id: number, body: ExerciseInput) => this.put<Exercise>(`/exercises/${id}`, body);
  deleteExercise = (id: number) => this.delete(`/exercises/${id}`);
  equipments = () => this.get<Equipment[]>('/equipments');
  createEquipment = (name: string) => this.post<Equipment>('/equipments', { name });
  updateEquipment = (id: number, name: string) => this.put<Equipment>(`/equipments/${id}`, { name });
  deleteEquipment = (id: number) => this.delete(`/equipments/${id}`);

  // ── workouts ──
  workouts = (filters: WorkoutFilters) => this.get<Workout[]>('/workouts', filters);
  workout = (id: number, userId?: number | null) =>
    this.get<Workout>(`/workouts/${id}`, { user_id: userId });
  createWorkout = (body: WorkoutInput) => this.post<Workout>('/workouts', body);
  updateWorkout = (id: number, body: WorkoutInput) => this.put<Workout>(`/workouts/${id}`, body);
  deleteWorkout = (id: number) => this.delete(`/workouts/${id}`);
  stats = (query: { user_id?: number | null; date_from?: string | null; date_to?: string | null }) =>
    this.get<Stats>('/stats', query);

  // ── templates and saved circuits ──
  templates = (userId?: number | null) => this.get<Template[]>('/templates', { user_id: userId });
  template = (id: number) => this.get<Template>(`/templates/${id}`);
  createTemplate = (body: TemplateInput) => this.post<Template>('/templates', body);
  updateTemplate = (id: number, body: TemplateInput) => this.put<Template>(`/templates/${id}`, body);
  deleteTemplate = (id: number) => this.delete(`/templates/${id}`);
  copyTemplate = (id: number, userId: number) =>
    this.post<Template>(`/templates/${id}/copy`, {}, { user_id: userId });
  circuits = () => this.get<SavedCircuit[]>('/circuits');
  circuit = (id: number) => this.get<SavedCircuit>(`/circuits/${id}`);
  createCircuit = (body: SavedCircuitInput) => this.post<SavedCircuit>('/circuits', body);
  updateCircuit = (id: number, body: SavedCircuitInput) =>
    this.put<SavedCircuit>(`/circuits/${id}`, body);
  deleteCircuit = (id: number) => this.delete(`/circuits/${id}`);

  // ── live session ──
  session = () => this.get<Workout | null>('/session');
  startSession = (templateId: number | null) =>
    this.post<Workout>('/session', { template_id: templateId });
  discardSession = () => this.delete('/session');
  finishSession = (checkedSetIds: number[], date: string) =>
    this.post<Workout>('/session/finish', { checked_set_ids: checkedSetIds, date });
  addSessionExercise = (exerciseId: number, circuitId: number | null = null) =>
    this.post<ExerciseEntry>('/session/exercises', { exercise_id: exerciseId, circuit_id: circuitId });
  removeSessionExercise = (rowId: number) => this.delete(`/session/exercises/${rowId}`);
  addSessionCircuit = (body: {
    name: string | null;
    duration_minutes: number | null;
    rounds: number | null;
    exercise_ids: number[];
  }) => this.post<CircuitEntry>('/session/circuits', body);
  removeSessionCircuit = (id: number) => this.delete(`/session/circuits/${id}`);
  addSet = (rowId: number, set: SetValues) =>
    this.post<WorkoutSet>(`/session/exercises/${rowId}/sets`, set);
  updateSet = (setId: number, set: SetValues) => this.put<WorkoutSet>(`/session/sets/${setId}`, set);
  removeSet = (setId: number) => this.delete(`/session/sets/${setId}`);

  // ── import / export ──
  exportFile = (kind: FileKind) => this.get<unknown[]>(`/${kind}/export`);
  importFile = (kind: FileKind, data: unknown) => this.post<ImportResult>(`/${kind}/import`, data);
  adminExport = (kind: AdminFileKind, userIds: number[] = []) =>
    this.get<unknown[]>(`/admin/${kind}/export`, { user_ids: userIds });
  adminImport = (kind: AdminFileKind, data: unknown) =>
    this.post<ImportResult>(`/admin/${kind}/import`, data);
  adminDeleteAll = (kind: AdminFileKind, userIds: number[] = []) =>
    this.delete(`/admin/${kind}`, { user_ids: userIds });
}
