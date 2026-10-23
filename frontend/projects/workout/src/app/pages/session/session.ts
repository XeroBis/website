import { Component, DestroyRef, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon } from '@shared';

import { ConfirmButton } from '../../ui/confirm-button';
import { ExercisePicker } from '../../ui/exercise-picker';
import { WorkoutApi, errorMessage } from '../../workout/api';
import { defaultFields, formatClock, isoDate } from '../../workout/format';
import {
  CircuitEntry,
  Entry,
  Exercise,
  ExerciseEntry,
  SET_FIELDS,
  SavedCircuit,
  SetField,
  SetValues,
  Workout,
  WorkoutSet,
} from '../../workout/models';
import { setValues } from '../../workout/rows';

export const REST_SECONDS = 90;
const STORAGE = 'workout.session.checked';

function sameSet(a: SetValues, b: SetValues): boolean {
  return SET_FIELDS.every((f) => (a[f] ?? null) === (b[f] ?? null));
}

/** Checked set ids survive a reload (finish deletes unchecked sets). */
function storedChecked(sessionId: number): Set<number> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
    return saved?.session === sessionId ? new Set(saved.ids) : new Set();
  } catch {
    return new Set();
  }
}

/** The live session: start, log sets with a rest timer, circuit rounds, finish or discard. */
@Component({
  selector: 'ab-session',
  imports: [ConfirmButton, ExercisePicker, FormsModule, Icon, RouterLink, TranslatePipe],
  templateUrl: './session.html',
})
export class SessionPage {
  private readonly api = inject(WorkoutApi);
  private readonly router = inject(Router);

  protected readonly templates = resource({ loader: () => this.api.templates() });
  protected readonly exercises = resource({ loader: () => this.api.exercises() });
  protected readonly savedCircuits = resource({ loader: () => this.api.circuits() });

  protected readonly session = signal<Workout | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly startTemplate = signal<number | null>(null);

  protected readonly checked = signal(new Set<number>());
  protected readonly saving = signal(new Set<number>());
  /** Edited values of each set, saved when it's checked. */
  private readonly edits = new Map<number, SetValues>();
  protected readonly expanded = signal(new Set<number>());
  protected readonly focusedId = signal<number | null>(null);
  /** Per circuit: index of the member whose turn it is. */
  protected readonly cursor = signal(new Map<number, number>());
  /** Per circuit member: the round about to be logged. */
  private readonly roundInputs = new Map<number, SetValues>();

  protected readonly elapsed = signal(0);
  protected readonly rest = signal(0);
  protected readonly restTotal = REST_SECONDS;
  /** null: closed; 0: a top-level exercise; else the circuit to add into. */
  protected readonly picker = signal<number | null>(null);
  protected readonly circuitForm = signal(false);
  protected newCircuit = { name: '', duration_minutes: null as number | null, rounds: null as number | null };

  protected readonly formatClock = formatClock;

  protected readonly activeEntry = computed<Entry | null>(() => {
    const entries = this.session()?.exercises ?? [];
    if (!entries.length) return null;
    const focused = entries.find((e) => e.id === this.focusedId());
    return focused ?? entries.find((e) => !this.entryDone(e)) ?? entries.at(-1)!;
  });
  protected readonly otherEntries = computed(() =>
    (this.session()?.exercises ?? []).filter((e) => e.id !== this.activeEntry()?.id),
  );
  protected readonly allDone = computed(() => {
    const standalone = (this.session()?.exercises ?? []).filter((e) => e.type === 'exercise');
    return standalone.length > 0 && standalone.every((e) => this.entryDone(e));
  });

  constructor() {
    const clock = setInterval(() => this.tick(), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(clock));
    this.api.session().then(
      (s) => {
        if (s) this.open(s);
        this.loading.set(false);
      },
      (e) => {
        this.error.set(errorMessage(e));
        this.loading.set(false);
      },
    );
  }

  private open(s: Workout): void {
    this.session.set(s);
    this.checked.set(storedChecked(s.id));
    this.tick();
  }

  private tick(): void {
    const started = this.session()?.started_at;
    if (started) this.elapsed.set(Math.max(0, Math.floor((Date.now() - Date.parse(started)) / 1000)));
    if (this.rest() > 0) this.rest.update((r) => r - 1);
  }

  /** Re-render after mutating the session's nested arrays. */
  private touch(): void {
    this.session.update((s) => (s ? { ...s } : s));
  }

  private setChecked(ids: Set<number>): void {
    this.checked.set(ids);
    try {
      localStorage.setItem(STORAGE, JSON.stringify({ session: this.session()?.id, ids: [...ids] }));
    } catch {
      // storage disabled: checks only last until a reload
    }
  }

  private async attempt(action: () => Promise<void>): Promise<void> {
    try {
      this.error.set(null);
      await action();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  // ── state ──

  protected exerciseDone(ex: ExerciseEntry): boolean {
    return ex.sets.length > 0 && ex.sets.every((s) => this.checked().has(s.id));
  }

  /** Circuits never auto-complete: rounds are logged for the length of the block. */
  protected entryDone(e: Entry): boolean {
    return e.type === 'exercise' && this.exerciseDone(e);
  }

  protected doneCount(ex: ExerciseEntry): number {
    return ex.sets.filter((s) => this.checked().has(s.id)).length;
  }

  protected fields(ex: ExerciseEntry): SetField[] {
    return this.expanded().has(ex.id) ? [...SET_FIELDS] : defaultFields(ex.exercise.type);
  }

  protected toggleFields(id: number): void {
    const next = new Set(this.expanded());
    if (!next.delete(id)) next.add(id);
    this.expanded.set(next);
  }

  protected focus(e: Entry): void {
    if (this.entryDone(e)) return;
    this.focusedId.set(e.id === this.focusedId() ? null : e.id);
  }

  // ── sets ──

  protected value(set: WorkoutSet, field: SetField): number | null {
    return (this.edits.get(set.id) ?? set)[field] ?? null;
  }

  protected edit(set: WorkoutSet, field: SetField, raw: string): void {
    const values = this.edits.get(set.id) ?? setValues(set);
    values[field] = raw === '' ? null : Number(raw);
    this.edits.set(set.id, values);
    // Already checked: save now rather than on a check that already happened.
    if (this.checked().has(set.id)) this.saveSet(set);
  }

  private async saveSet(set: WorkoutSet): Promise<boolean> {
    const values = this.edits.get(set.id);
    if (!values || sameSet(values, set)) return true;
    this.saving.update((s) => new Set(s).add(set.id));
    try {
      Object.assign(set, await this.api.updateSet(set.id, values));
      this.edits.delete(set.id);
      return true;
    } catch (e) {
      this.error.set(errorMessage(e));
      return false;
    } finally {
      this.saving.update((s) => {
        const next = new Set(s);
        next.delete(set.id);
        return next;
      });
      this.touch();
    }
  }

  protected async check(entry: Entry, set: WorkoutSet): Promise<void> {
    if (this.saving().has(set.id)) return;
    if (this.checked().has(set.id)) {
      const next = new Set(this.checked());
      next.delete(set.id);
      return this.setChecked(next);
    }
    if (!(await this.saveSet(set))) return;
    this.setChecked(new Set(this.checked()).add(set.id));
    this.rest.set(REST_SECONDS);
    if (this.entryDone(entry) && this.focusedId() === entry.id) this.focusedId.set(null);
  }

  protected addSet(ex: ExerciseEntry): Promise<void> {
    return this.attempt(async () => {
      const last = ex.sets.at(-1);
      ex.sets.push(await this.api.addSet(ex.id, last ? setValues(this.edits.get(last.id) ?? last) : { reps: 10 }));
      this.touch();
    });
  }

  protected removeSet(ex: ExerciseEntry, set: WorkoutSet): Promise<void> {
    return this.attempt(async () => {
      await this.api.removeSet(set.id);
      ex.sets = ex.sets.filter((s) => s.id !== set.id);
      this.edits.delete(set.id);
      const next = new Set(this.checked());
      next.delete(set.id);
      this.setChecked(next);
      this.touch();
    });
  }

  protected skipRest(): void {
    this.rest.set(0);
  }

  // ── circuits ──

  protected roundsDone(c: CircuitEntry): number {
    return c.exercises.length ? Math.min(...c.exercises.map((e) => e.sets.length)) : 0;
  }

  protected member(c: CircuitEntry): ExerciseEntry | null {
    if (!c.exercises.length) return null;
    return c.exercises[(this.cursor().get(c.id) ?? 0) % c.exercises.length];
  }

  protected jump(c: CircuitEntry, index: number): void {
    this.cursor.set(new Map(this.cursor()).set(c.id, index));
  }

  private roundInput(ex: ExerciseEntry): SetValues {
    if (!this.roundInputs.has(ex.id)) {
      const last = ex.sets.at(-1);
      this.roundInputs.set(
        ex.id,
        last ? setValues(last) : ex.exercise.type === 'cardio' ? { duration_s: 30 } : { reps: 10 },
      );
    }
    return this.roundInputs.get(ex.id)!;
  }

  protected roundValue(ex: ExerciseEntry, field: SetField): number | null {
    return this.roundInput(ex)[field] ?? null;
  }

  protected editRound(ex: ExerciseEntry, field: SetField, raw: string): void {
    this.roundInput(ex)[field] = raw === '' ? null : Number(raw);
  }

  /** Log the member's round as a checked set and move to the next member. */
  protected logRound(c: CircuitEntry, ex: ExerciseEntry): Promise<void> {
    return this.attempt(async () => {
      this.busy.set(true);
      try {
        const set = await this.api.addSet(ex.id, this.roundInput(ex));
        ex.sets.push(set);
        this.roundInputs.delete(ex.id);
        this.setChecked(new Set(this.checked()).add(set.id));
        this.jump(c, ((this.cursor().get(c.id) ?? 0) + 1) % c.exercises.length);
        this.touch();
      } finally {
        this.busy.set(false);
      }
    });
  }

  // ── adding and removing entries ──

  protected addExercise(exercise: Exercise): Promise<void> {
    const circuitId = this.picker() || null;
    this.picker.set(null);
    return this.attempt(async () => {
      const row = await this.api.addSessionExercise(exercise.id, circuitId);
      const s = this.session()!;
      if (circuitId) (s.exercises.find((e) => e.id === circuitId) as CircuitEntry).exercises.push(row);
      else s.exercises.push(row);
      this.focusedId.set(circuitId ?? row.id);
      this.touch();
    });
  }

  protected removeExercise(row: ExerciseEntry, circuit: CircuitEntry | null): Promise<void> {
    return this.attempt(async () => {
      await this.api.removeSessionExercise(row.id);
      if (circuit) circuit.exercises = circuit.exercises.filter((e) => e.id !== row.id);
      else this.session()!.exercises = this.session()!.exercises.filter((e) => e.id !== row.id);
      this.touch();
    });
  }

  protected createCircuit(saved: SavedCircuit | null = null): Promise<void> {
    const body = saved
      ? {
          name: saved.name,
          duration_minutes: saved.duration_minutes,
          rounds: saved.rounds,
          exercise_ids: saved.exercises.map((e) => e.exercise_id),
        }
      : { ...this.newCircuit, name: this.newCircuit.name.trim() || null, exercise_ids: [] };
    return this.attempt(async () => {
      const circuit = await this.api.addSessionCircuit(body);
      this.session()!.exercises.push(circuit);
      this.focusedId.set(circuit.id);
      this.circuitForm.set(false);
      this.newCircuit = { name: '', duration_minutes: null, rounds: null };
      this.touch();
    });
  }

  protected insertSaved(id: number): Promise<void> {
    const saved = this.savedCircuits.value()?.find((c) => c.id === id);
    return saved ? this.createCircuit(saved) : Promise.resolve();
  }

  protected removeCircuit(c: CircuitEntry): Promise<void> {
    return this.attempt(async () => {
      await this.api.removeSessionCircuit(c.id);
      this.session()!.exercises = this.session()!.exercises.filter((e) => e.id !== c.id);
      this.touch();
    });
  }

  // ── start / finish / discard ──

  protected start(templateId: number | null): Promise<void> {
    return this.attempt(async () => {
      this.busy.set(true);
      try {
        this.open(await this.api.startSession({ template_id: templateId }));
      } finally {
        this.busy.set(false);
      }
    });
  }

  protected finish(): Promise<void> {
    return this.attempt(async () => {
      this.busy.set(true);
      try {
        // Unsaved edits of checked sets first.
        const sets = (this.session()?.exercises ?? [])
          .flatMap((e) => (e.type === 'circuit' ? e.exercises : [e]))
          .flatMap((e) => e.sets)
          .filter((s) => this.checked().has(s.id));
        for (const set of sets) await this.saveSet(set);
        await this.api.finishSession([...this.checked()], isoDate(new Date()));
        this.clearStored();
        await this.router.navigateByUrl('/workouts');
      } finally {
        this.busy.set(false);
      }
    });
  }

  protected discard(): Promise<void> {
    return this.attempt(async () => {
      await this.api.discardSession();
      this.clearStored();
      await this.router.navigateByUrl('/workouts');
    });
  }

  private clearStored(): void {
    try {
      localStorage.removeItem(STORAGE);
    } catch {
      // nothing stored
    }
  }
}
