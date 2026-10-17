import { Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthService, Icon } from '@shared';

import { ConfirmButton } from '../../ui/confirm-button';
import { WorkoutApi, errorMessage } from '../../workout/api';
import { Equipment } from '../../workout/models';

/** The equipment list: anyone adds, admins rename and delete inline. */
@Component({
  selector: 'ab-equipments',
  imports: [ConfirmButton, FormsModule, Icon, TranslatePipe],
  template: `
    <div class="toolbar">
      <input
        type="search"
        [placeholder]="'equipments.search' | translate"
        [attr.aria-label]="'equipments.search' | translate"
        [value]="q()"
        (input)="q.set($any($event.target).value)"
      />
      <form class="inline push" (ngSubmit)="add()">
        <input type="text" name="name" maxlength="100" [placeholder]="'equipments.name' | translate" [(ngModel)]="newName" />
        <button type="submit" class="btn primary"><ab-icon name="plus" /> {{ 'equipments.new' | translate }}</button>
      </form>
    </div>
    @if (error(); as e) {
      <p class="error" data-testid="error">{{ e | translate }}</p>
    }
    <table class="table card">
      <tbody>
        @for (eq of filtered(); track eq.id) {
          <tr data-testid="equipment">
            <td>
              @if (editing() === eq.id) {
                <input type="text" maxlength="100" [(ngModel)]="editName" [attr.aria-label]="'equipments.name' | translate" />
              } @else {
                {{ eq.name }}
              }
            </td>
            <td class="actions">
              @if (auth.isAdmin()) {
                @if (editing() === eq.id) {
                  <button type="button" class="btn primary sm" (click)="rename(eq)">{{ 'common.save' | translate }}</button>
                  <button type="button" class="btn ghost sm" (click)="editing.set(null)">{{ 'common.cancel' | translate }}</button>
                } @else {
                  <button type="button" class="btn ghost sm" (click)="startEdit(eq)"><ab-icon name="pencil" /> {{ 'common.edit' | translate }}</button>
                  <ab-confirm-button label="common.delete" (confirmed)="remove(eq)" />
                }
              }
            </td>
          </tr>
        } @empty {
          @if (equipments.hasValue()) {
            <tr><td class="empty">{{ 'equipments.empty' | translate }}</td></tr>
          }
        }
      </tbody>
    </table>
  `,
})
export class Equipments {
  private readonly api = inject(WorkoutApi);
  protected readonly auth = inject(AuthService);
  protected readonly equipments = resource({ loader: () => this.api.equipments() });
  protected readonly q = signal('');
  protected readonly editing = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);
  protected newName = '';
  protected editName = '';

  protected readonly filtered = computed(() => {
    const q = this.q().trim().toLowerCase();
    return (this.equipments.value() ?? []).filter((e) => e.name.toLowerCase().includes(q));
  });

  private async run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
      this.error.set(null);
      this.equipments.reload();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  protected add(): Promise<void> {
    const name = this.newName.trim();
    if (!name) return Promise.resolve();
    return this.run(async () => {
      await this.api.createEquipment(name);
      this.newName = '';
    });
  }

  protected startEdit(eq: Equipment): void {
    this.editName = eq.name;
    this.editing.set(eq.id);
  }

  protected rename(eq: Equipment): Promise<void> {
    return this.run(async () => {
      await this.api.updateEquipment(eq.id, this.editName.trim());
      this.editing.set(null);
    });
  }

  protected remove(eq: Equipment): Promise<void> {
    return this.run(() => this.api.deleteEquipment(eq.id));
  }
}
