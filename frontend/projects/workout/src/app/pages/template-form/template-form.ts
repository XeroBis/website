import { Component, inject, input, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { EntriesEditor } from '../../ui/entries-editor';
import { WorkoutApi, errorMessage } from '../../workout/api';
import { Row, RowError, blankExercise, isRowError, rowsFromEntries, toEntries } from '../../workout/rows';

/** `/templates/new` and `/templates/:id`. */
@Component({
  selector: 'ab-template-form',
  imports: [EntriesEditor, FormsModule, RouterLink, TranslatePipe],
  template: `
    <div class="page-head">
      <h1>{{ (isNew() ? 'templates.titleNew' : 'templates.titleEdit') | translate }}</h1>
      <a class="btn ghost" routerLink="/templates">{{ 'common.cancel' | translate }}</a>
    </div>
    @if (state() === 'missing') {
      <p class="error">{{ 'templates.notFound' | translate }}</p>
    } @else if (state() === 'ready') {
      <form class="card stack" (ngSubmit)="save()">
        <label
          >{{ 'templates.name' | translate }}
          <input type="text" name="name" maxlength="100" required [(ngModel)]="name" />
        </label>
        <h2>{{ 'editor.exercises' | translate }}</h2>
        <ab-entries-editor [(rows)]="rows" [exercises]="exercises.value() ?? []" [savedCircuits]="circuits.value() ?? []" />
        @if (error(); as e) {
          <p class="error" data-testid="form-error">{{ e.key | translate: e.params }}</p>
        }
        <button type="submit" class="btn primary" [disabled]="saving()">
          {{ (saving() ? 'common.saving' : 'common.save') | translate }}
        </button>
      </form>
    } @else {
      <p class="muted">{{ 'common.loading' | translate }}</p>
    }
  `,
})
export class TemplateForm {
  /** Route param: `new` or an id. */
  readonly id = input.required<string>();

  private readonly api = inject(WorkoutApi);
  private readonly router = inject(Router);
  protected readonly exercises = resource({ loader: () => this.api.exercises() });
  protected readonly circuits = resource({ loader: () => this.api.circuits() });
  protected name = '';
  protected readonly rows = signal<Row[]>([blankExercise()]);
  protected readonly state = signal<'loading' | 'ready' | 'missing'>('loading');
  protected readonly saving = signal(false);
  protected readonly error = signal<RowError | null>(null);

  protected isNew(): boolean {
    return this.id() === 'new';
  }

  async ngOnInit(): Promise<void> {
    if (this.isNew()) return this.state.set('ready');
    try {
      const t = await this.api.template(Number(this.id()));
      this.name = t.name;
      this.rows.set(rowsFromEntries(t.exercises));
      this.state.set('ready');
    } catch {
      this.state.set('missing');
    }
  }

  protected async save(): Promise<void> {
    if (!this.name.trim()) return this.error.set({ key: 'templates.errName' });
    const exercises = toEntries(this.rows());
    if (isRowError(exercises)) return this.error.set(exercises);
    this.error.set(null);
    this.saving.set(true);
    const body = { name: this.name.trim(), exercises };
    try {
      if (this.isNew()) await this.api.createTemplate(body);
      else await this.api.updateTemplate(Number(this.id()), body);
      await this.router.navigateByUrl('/templates');
    } catch (e) {
      this.error.set({ key: errorMessage(e) });
      this.saving.set(false);
    }
  }
}
