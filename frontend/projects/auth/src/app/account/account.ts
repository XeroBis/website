import { Component, WritableSignal, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AppName, AuthService, ENVIRONMENT, httpStatus, Language } from '@shared';

const LINKED_APPS: AppName[] = ['portfolio', 'workout', 'cards', 'media'];

/** `/` (behind authGuard): pseudo, language, links to the apps, logout. */
@Component({
  selector: 'ab-account',
  imports: [ReactiveFormsModule, TranslatePipe],
  template: `
    @if (auth.user(); as user) {
      <main class="card">
        <h1>{{ 'ACCOUNT.TITLE' | translate }}</h1>

        <section class="identity">
          @if (editing()) {
            <form [formGroup]="pseudoForm" (ngSubmit)="savePseudo()">
              <label>
                {{ 'ACCOUNT.PSEUDO' | translate }}
                <input
                  type="text"
                  formControlName="pseudo"
                  autocomplete="nickname"
                  maxlength="50"
                  [placeholder]="'ACCOUNT.PSEUDO_PLACEHOLDER' | translate"
                />
              </label>
              @if (pseudoError()) {
                <p class="error" role="alert">{{ pseudoError() | translate }}</p>
              }
              <div class="row">
                <button type="submit" [disabled]="pseudoForm.invalid || saving()">
                  {{ 'ACCOUNT.SAVE' | translate }}
                </button>
                <button type="button" class="link-btn" (click)="editing.set(false)">
                  {{ 'ACCOUNT.CANCEL' | translate }}
                </button>
              </div>
            </form>
          } @else {
            <p class="pseudo">{{ user.pseudo }}</p>
            <p class="email">{{ user.email }}</p>
            <button type="button" class="link-btn" (click)="startEditing()">
              {{ 'ACCOUNT.CHANGE_PSEUDO' | translate }}
            </button>
          }

          <div class="language-picker">
            <span>{{ 'ACCOUNT.LANGUAGE' | translate }}</span>
            @for (lang of languages; track lang.code) {
              <button
                type="button"
                class="lang-btn"
                [class.active]="user.language === lang.code"
                [disabled]="saving()"
                (click)="setLanguage(lang.code)"
              >
                {{ lang.label }}
              </button>
            }
          </div>
          @if (languageError()) {
            <p class="error" role="alert">{{ languageError() | translate }}</p>
          }
        </section>

        <p class="subtitle">{{ 'ACCOUNT.WHERE_TO' | translate }}</p>
        <nav class="app-list">
          @for (app of apps; track app.key) {
            <a class="app-link" [href]="app.url">
              <span class="app-name">{{ 'APPS.' + app.key | translate }}</span>
              <span class="app-description">{{ 'APPS.' + app.key + '_DESC' | translate }}</span>
            </a>
          }
        </nav>

        <button type="button" class="logout" (click)="logout()">
          {{ 'ACCOUNT.LOGOUT' | translate }}
        </button>
      </main>
    }
  `,
})
export class Account {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly env = inject(ENVIRONMENT);

  protected readonly languages: { code: Language; label: string }[] = [
    { code: 'fr', label: 'Français' },
    { code: 'en', label: 'English' },
  ];
  protected readonly apps = LINKED_APPS.map((app) => ({
    key: app.toUpperCase(),
    url: `${this.env.appUrls[app]}/`,
  }));

  protected readonly pseudoForm = inject(NonNullableFormBuilder).group({
    pseudo: ['', [Validators.required, Validators.maxLength(50), Validators.pattern(/\S/)]],
  });
  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly pseudoError = signal('');
  protected readonly languageError = signal('');

  protected startEditing(): void {
    this.pseudoForm.setValue({ pseudo: this.auth.user()?.pseudo ?? '' });
    this.pseudoError.set('');
    this.editing.set(true);
  }

  protected async savePseudo(): Promise<void> {
    await this.save(this.pseudoError, 'ACCOUNT.ERROR_PSEUDO_SAVE', async () => {
      await this.auth.updatePseudo(this.pseudoForm.getRawValue().pseudo);
      this.editing.set(false);
    });
  }

  protected async setLanguage(language: Language): Promise<void> {
    if (language === this.auth.user()?.language) return;
    await this.save(this.languageError, 'ACCOUNT.ERROR_LANGUAGE_SAVE', () =>
      this.auth.updateLanguage(language),
    );
  }

  protected async logout(): Promise<void> {
    try {
      await this.auth.logout();
    } finally {
      await this.router.navigateByUrl('/login');
    }
  }

  private async save(
    error: WritableSignal<string>,
    message: string,
    action: () => Promise<unknown>,
  ): Promise<void> {
    error.set('');
    this.saving.set(true);
    try {
      await action();
    } catch (err) {
      error.set(httpStatus(err) === 401 ? 'ACCOUNT.ERROR_SESSION_EXPIRED' : message);
    } finally {
      this.saving.set(false);
    }
  }
}
