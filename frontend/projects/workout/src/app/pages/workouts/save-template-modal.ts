import { Component, inject, input, output, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { Modal } from '../../ui/modal';
import { WorkoutApi, errorMessage } from '../../workout/api';
import { Workout } from '../../workout/models';
import { isRowError, rowsFromEntries, toEntries } from '../../workout/rows';

/** Save a workout's entries as a new template, or over one of yours. */
@Component({
  selector: 'ab-save-template-modal',
  imports: [FormsModule, Modal, TranslatePipe],
  template: `
    <ab-modal [heading]="'saveTemplate.title' | translate" (closed)="closed.emit()">
      <form class="stack" (ngSubmit)="save()">
        @if (templates.value()?.length) {
          <div class="segmented" role="group">
            <button type="button" [class.active]="mode() === 'create'" (click)="mode.set('create')">
              {{ 'saveTemplate.create' | translate }}
            </button>
            <button type="button" [class.active]="mode() === 'replace'" (click)="mode.set('replace')">
              {{ 'saveTemplate.replace' | translate }}
            </button>
          </div>
        }
        @if (mode() === 'create') {
          <label
            >{{ 'templates.name' | translate }}
            <input type="text" name="name" maxlength="100" required [(ngModel)]="name" />
          </label>
        } @else {
          <label
            >{{ 'saveTemplate.pick' | translate }}
            <select name="target" [(ngModel)]="target">
              @for (t of templates.value(); track t.id) {
                <option [ngValue]="t.id">{{ t.name }}</option>
              }
            </select>
          </label>
        }
        @if (error(); as e) {
          <p class="error">{{ e | translate }}</p>
        }
        <button type="submit" class="btn primary" [disabled]="saving()">
          {{ (saving() ? 'common.saving' : 'common.save') | translate }}
        </button>
      </form>
    </ab-modal>
  `,
})
export class SaveTemplateModal {
  readonly workout = input.required<Workout>();
  readonly closed = output<void>();
  readonly saved = output<void>();

  private readonly api = inject(WorkoutApi);
  protected readonly templates = resource({ loader: () => this.api.templates() });
  protected readonly mode = signal<'create' | 'replace'>('create');
  protected name = '';
  protected target: number | null = null;
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async save(): Promise<void> {
    const exercises = toEntries(rowsFromEntries(this.workout().exercises));
    if (isRowError(exercises)) return this.error.set(exercises.key);
    const existing = this.templates.value()?.find((t) => t.id === this.target);
    if (this.mode() === 'create' ? !this.name.trim() : !existing) {
      return this.error.set('templates.errName');
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      if (this.mode() === 'create') await this.api.createTemplate({ name: this.name.trim(), exercises });
      else await this.api.updateTemplate(existing!.id, { name: existing!.name, exercises });
      this.saved.emit();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
