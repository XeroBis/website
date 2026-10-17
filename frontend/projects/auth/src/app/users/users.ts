import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminUser, GRANTABLE_APPS, GrantableApp, httpStatus } from '@shared';

import { UsersService } from './users.service';

/**
 * `/admin/users` (behind adminGuard): every account, oldest first, with one
 * checkbox per app. A click saves at once; admins have every app, so their
 * row has no checkboxes.
 */
@Component({
  selector: 'ab-users',
  imports: [RouterLink, TranslatePipe],
  template: `
    <main class="card wide">
      <h1>{{ 'USERS.TITLE' | translate }}</h1>
      <p class="subtitle">{{ 'USERS.SUBTITLE' | translate }}</p>

      @if (loadError()) {
        <p class="error" role="alert">{{ loadError() | translate }}</p>
      } @else if (users() === null) {
        <p class="hint">{{ 'USERS.LOADING' | translate }}</p>
      } @else {
        <ul class="user-list">
          @for (user of users(); track user.id) {
            <li class="user-row" [attr.data-testid]="'user-' + user.id">
              <div class="user-identity">
                <span class="pseudo">{{ user.pseudo }}</span>
                <span class="email">{{ user.email }}</span>
                <span class="since">{{ 'USERS.SINCE' | translate: { date: user.created_at.slice(0, 10) } }}</span>
              </div>
              @if (user.is_admin) {
                <p class="all-apps">{{ 'USERS.ALL_APPS' | translate }}</p>
              } @else {
                <div class="app-toggles">
                  @for (app of appList; track app) {
                    <label class="app-toggle">
                      <input
                        type="checkbox"
                        [checked]="user.apps.includes(app)"
                        [disabled]="saving().has(user.id)"
                        (change)="toggle(user, app, $event)"
                      />
                      {{ 'USERS.APP_' + app.toUpperCase() | translate }}
                    </label>
                  }
                </div>
              }
              @if (rowErrors()[user.id]; as error) {
                <p class="error" role="alert">{{ error | translate }}</p>
              }
            </li>
          }
        </ul>
      }

      <p class="alt-action"><a routerLink="/">{{ 'USERS.BACK' | translate }}</a></p>
    </main>
  `,
})
export class Users {
  private readonly service = inject(UsersService);

  protected readonly appList = GRANTABLE_APPS;
  protected readonly users = signal<AdminUser[] | null>(null);
  protected readonly loadError = signal('');
  protected readonly saving = signal(new Set<number>());
  protected readonly rowErrors = signal<Record<number, string>>({});

  constructor() {
    this.service.list().then(
      (users) => this.users.set(users),
      (err: unknown) => this.loadError.set(this.errorKey(err, 'USERS.ERROR_LOAD')),
    );
  }

  protected async toggle(user: AdminUser, app: GrantableApp, event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    const apps = box.checked ? [...user.apps, app] : user.apps.filter((a) => a !== app);
    this.setSaving(user.id, true);
    this.rowErrors.update(({ [user.id]: _, ...rest }) => rest);
    try {
      const updated = await this.service.setApps(user.id, apps);
      this.users.update((users) => users?.map((u) => (u.id === updated.id ? updated : u)) ?? null);
    } catch (err) {
      box.checked = user.apps.includes(app); // back to what is saved
      this.rowErrors.update((errors) => ({
        ...errors,
        [user.id]: this.errorKey(err, 'USERS.ERROR_SAVE'),
      }));
    } finally {
      this.setSaving(user.id, false);
    }
  }

  private setSaving(userId: number, on: boolean): void {
    this.saving.update((ids) => {
      const next = new Set(ids);
      if (on) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  private errorKey(err: unknown, fallback: string): string {
    const status = httpStatus(err);
    if (status === 401) return 'USERS.ERROR_SESSION_EXPIRED';
    if (status === 403) return 'USERS.ERROR_FORBIDDEN';
    return fallback;
  }
}
