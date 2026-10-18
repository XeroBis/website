import { Component, computed, inject, resource, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { TransferSection } from '../../ui/transfer-section';
import { AdminFileKind, WorkoutApi, errorMessage } from '../../workout/api';

/**
 * Catalog files, multi-user workout/template/circuit files (matched by email, how
 * prod data is reloaded) and delete-all, for the users ticked below.
 */
@Component({
  selector: 'ab-admin',
  imports: [TransferSection, TranslatePipe],
  template: `
    <h1>{{ 'nav.admin' | translate }}</h1>
    <section class="card">
      <h2>{{ 'admin.users' | translate }}</h2>
      <div class="checks">
        <label class="check-label">
          <input type="checkbox" data-testid="all-users" [checked]="allChecked()" (change)="toggleAll()" />
          {{ 'admin.allUsers' | translate }}
        </label>
        @for (u of users.value(); track u.id) {
          <label class="check-label">
            <input type="checkbox" [checked]="picked().has(u.id)" (change)="toggle(u.id)" />
            {{ u.pseudo }}
          </label>
        }
      </div>
    </section>
    @if (error(); as e) {
      <p class="error">{{ e | translate }}</p>
    }
    @if (done(); as d) {
      <p class="success">{{ 'admin.deleted' | translate: { what: (d | translate) } }}</p>
    }
    @for (s of sections; track s.kind) {
      <ab-transfer-section
        [heading]="'admin.' + s.kind"
        [filename]="s.kind + '.json'"
        [shape]="s.shape"
        [fetch]="exporter(s.kind)"
        [send]="importer(s.kind)"
        [canDeleteAll]="true"
        [disabled]="s.perUser && !picked().size"
        (deleteAll)="deleteAll(s.kind)"
      />
    }
  `,
})
export class Admin {
  private readonly api = inject(WorkoutApi);
  protected readonly users = resource({ loader: () => this.api.users() });
  /** Ticked users; null until changed = everyone. */
  private readonly ticked = signal<Set<number> | null>(null);
  protected readonly picked = computed(
    () => this.ticked() ?? new Set((this.users.value() ?? []).map((u) => u.id)),
  );
  protected readonly allChecked = computed(() =>
    (this.users.value() ?? []).every((u) => this.picked().has(u.id)),
  );
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal<string | null>(null);

  protected readonly sections = [
    { kind: 'workouts', shape: 'userWorkouts', perUser: true },
    { kind: 'templates', shape: 'userTemplates', perUser: true },
    { kind: 'circuits', shape: 'userCircuits', perUser: true },
    { kind: 'exercises', shape: 'exercises', perUser: false },
    { kind: 'equipments', shape: 'equipments', perUser: false },
  ] as const;

  protected toggle(id: number): void {
    const next = new Set(this.picked());
    if (!next.delete(id)) next.add(id);
    this.ticked.set(next);
  }

  protected toggleAll(): void {
    this.ticked.set(this.allChecked() ? new Set() : null);
  }

  protected exporter(kind: AdminFileKind) {
    return () => this.api.adminExport(kind, [...this.picked()]);
  }

  protected importer(kind: AdminFileKind) {
    return (data: unknown) => this.api.adminImport(kind, data);
  }

  protected async deleteAll(kind: AdminFileKind): Promise<void> {
    this.error.set(null);
    this.done.set(null);
    try {
      await this.api.adminDeleteAll(kind, [...this.picked()]);
      this.done.set('admin.' + kind);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
