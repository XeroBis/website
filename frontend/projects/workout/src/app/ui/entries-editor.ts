import { NgTemplateOutlet } from '@angular/common';
import { Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon } from '@shared';

import { defaultFields } from '../workout/format';
import { Exercise, SET_FIELDS, SavedCircuit, SetField } from '../workout/models';
import {
  CircuitRow,
  ExerciseRow,
  Row,
  blankCircuit,
  blankExercise,
  circuitRow,
  move,
  rowsFromSavedCircuit,
} from '../workout/rows';
import { ExercisePicker } from './exercise-picker';

/** Step and minimum of each set field's input. */
const FIELD_INPUT: Record<SetField, { step: number; min: number | null }> = {
  reps: { step: 1, min: 1 },
  weight_kg: { step: 0.5, min: null },
  duration_s: { step: 1, min: 1 },
  distance_m: { step: 1, min: 0 },
  speed_kmh: { step: 0.1, min: 0 },
  difficulty: { step: 0.5, min: 0 },
};

/**
 * Rows of exercises (picker + sets) and circuits (name, duration, rounds,
 * their own exercise rows), reorderable. Used by the workout, template and
 * saved-circuit forms; with `circuits` false it edits a flat list of exercises.
 */
@Component({
  selector: 'ab-entries-editor',
  imports: [ExercisePicker, FormsModule, Icon, NgTemplateOutlet, TranslatePipe],
  template: `
    @for (row of rows(); track row.key; let i = $index) {
      @if (row.kind === 'circuit') {
        <section class="editor-row circuit-block" data-type="circuit" data-testid="circuit-row">
          <div class="row-head">
            <span class="row-num">{{ i + 1 }}</span>
            <ng-container *ngTemplateOutlet="arrows; context: { list: rows(), i, set: setRows }" />
            <span class="badge" data-type="circuit">{{ 'type.circuit' | translate }}</span>
            <button type="button" class="btn danger sm push" (click)="removeRow(i)">
              {{ 'editor.removeCircuit' | translate }}
            </button>
          </div>
          <div class="fields">
            <label
              >{{ 'editor.circuitName' | translate }}
              <input type="text" maxlength="100" [(ngModel)]="row.name" />
            </label>
            <label
              >{{ 'editor.circuitDuration' | translate }}
              <input type="number" min="1" max="1440" [(ngModel)]="row.duration_minutes" />
            </label>
            <label
              >{{ 'editor.circuitRounds' | translate }}
              <input type="number" min="1" max="1000" [(ngModel)]="row.rounds" />
            </label>
          </div>
          @for (member of row.rows; track member.key; let j = $index) {
            <ng-container
              *ngTemplateOutlet="exerciseRow; context: { row: member, n: j + 1, list: row.rows, i: j, circuit: row }"
            />
          }
          <button type="button" class="btn ghost sm" (click)="addMember(row)">
            <ab-icon name="plus" /> {{ 'editor.addExercise' | translate }}
          </button>
        </section>
      } @else {
        <ng-container *ngTemplateOutlet="exerciseRow; context: { row, n: i + 1, list: rows(), i, circuit: null }" />
      }
    }

    <div class="editor-actions">
      <button type="button" class="btn ghost" (click)="add(blank())">
        <ab-icon name="plus" /> {{ 'editor.addExercise' | translate }}
      </button>
      @if (circuits()) {
        <button type="button" class="btn ghost" (click)="add(blankCircuit())">
          <ab-icon name="repeat" /> {{ 'editor.addCircuit' | translate }}
        </button>
      }
      @if (savedCircuits().length) {
        <label class="inline"
          >{{ 'editor.insertCircuit' | translate }}
          <select #pick (change)="insert(+pick.value); pick.value = ''">
            <option value="">—</option>
            @for (c of savedCircuits(); track c.id) {
              <option [value]="c.id">{{ c.name }}</option>
            }
          </select>
        </label>
      }
      <ng-content />
    </div>

    <ng-template #arrows let-list="list" let-i="i" let-set="set">
      @if (list.length > 1) {
        <span class="arrows">
          <button type="button" class="icon-btn" [attr.aria-label]="'editor.moveUp' | translate" [disabled]="i === 0" (click)="set(move(list, i, -1))">
            <ab-icon name="chevron-up" />
          </button>
          <button
            type="button"
            class="icon-btn"
            [attr.aria-label]="'editor.moveDown' | translate"
            [disabled]="i === list.length - 1"
            (click)="set(move(list, i, 1))"
          >
            <ab-icon name="chevron-down" />
          </button>
        </span>
      }
    </ng-template>

    <ng-template #exerciseRow let-row="row" let-n="n" let-list="list" let-i="i" let-circuit="circuit">
      <section class="editor-row" data-testid="exercise-row">
        <div class="row-head">
          <span class="row-num">{{ n }}</span>
          <ng-container *ngTemplateOutlet="arrows; context: { list, i, set: circuit ? setMembers(circuit) : setRows }" />
          @if (row.exercise) {
            <span class="badge" [attr.data-type]="row.exercise.type">{{ 'type.' + row.exercise.type | translate }}</span>
          }
          @if (list.length > 1 || !circuit) {
            <button type="button" class="btn danger sm push" (click)="circuit ? removeMember(circuit, i) : removeRow(i)">
              {{ 'editor.remove' | translate }}
            </button>
          }
        </div>
        <ab-exercise-picker [exercises]="exercises()" [value]="row.exercise" (picked)="pickExercise(row, $event)" />
        <div class="sets-head">
          <span>{{ 'editor.sets' | translate }}</span>
          <button type="button" class="btn ghost sm" (click)="row.allFields = !row.allFields">
            {{ (row.allFields ? 'editor.fewerFields' : 'editor.moreFields') | translate }}
          </button>
        </div>
        @for (set of row.sets; track $index; let s = $index) {
          <div class="set-row">
            <span class="set-num">{{ s + 1 }}</span>
            @for (field of fieldsOf(row); track field) {
              <label
                >{{ 'field.' + field | translate }}
                <input
                  type="number"
                  [step]="fieldInput[field].step"
                  [attr.min]="fieldInput[field].min"
                  [(ngModel)]="set[field]"
                />
              </label>
            }
            @if (row.sets.length > 1) {
              <button type="button" class="icon-btn" [attr.aria-label]="'editor.removeSet' | translate" (click)="row.sets.splice(s, 1)">
                <ab-icon name="x" />
              </button>
            }
          </div>
        }
        <button type="button" class="btn ghost sm" (click)="addSet(row)">
          <ab-icon name="plus" /> {{ 'editor.addSet' | translate }}
        </button>
      </section>
    </ng-template>
  `,
})
export class EntriesEditor {
  readonly rows = model.required<Row[]>();
  readonly exercises = input.required<Exercise[]>();
  readonly savedCircuits = input<SavedCircuit[]>([]);
  /** False for a saved circuit: a flat list of exercises. */
  readonly circuits = input(true);

  protected readonly fieldInput = FIELD_INPUT;
  protected readonly move = move;
  protected readonly blank = blankExercise;
  protected readonly blankCircuit = blankCircuit;

  protected readonly setRows = (rows: Row[]) => this.rows.set(rows);
  protected setMembers(circuit: CircuitRow) {
    return (rows: ExerciseRow[]) => {
      circuit.rows = rows;
      this.rows.set([...this.rows()]);
    };
  }

  protected fieldsOf(row: ExerciseRow): SetField[] {
    if (row.allFields) return [...SET_FIELDS];
    return defaultFields(row.exercise?.type);
  }

  protected pickExercise(row: ExerciseRow, ex: Exercise): void {
    const changedType = row.exercise?.type !== ex.type;
    row.exercise = ex;
    // A fresh row gets sensible starting values for its type.
    if (changedType && row.sets.length === 1 && !Object.keys(row.sets[0]).length) {
      row.sets = [ex.type === 'cardio' ? { duration_s: 60 } : { reps: 10, weight_kg: 0 }];
    }
    this.rows.set([...this.rows()]);
  }

  protected addSet(row: ExerciseRow): void {
    row.sets.push({ ...(row.sets.at(-1) ?? {}) });
  }

  protected add(row: Row): void {
    // Replace a single untouched blank row rather than adding after it.
    const current = this.rows();
    const untouched = current.length === 1 && current[0].kind === 'exercise' && !current[0].exercise;
    this.rows.set(untouched ? [row] : [...current, row]);
  }

  protected insert(id: number): void {
    const saved = this.savedCircuits().find((c) => c.id === id);
    if (!saved) return;
    if (this.circuits()) this.add(circuitRow(saved));
    else this.rows.set([...this.rows(), ...rowsFromSavedCircuit(saved)]);
  }

  protected removeRow(i: number): void {
    this.rows.set(this.rows().filter((_, j) => j !== i));
  }

  protected addMember(circuit: CircuitRow): void {
    circuit.rows = [...circuit.rows, blankExercise()];
    this.rows.set([...this.rows()]);
  }

  protected removeMember(circuit: CircuitRow, i: number): void {
    circuit.rows = circuit.rows.filter((_, j) => j !== i);
    this.rows.set([...this.rows()]);
  }
}
