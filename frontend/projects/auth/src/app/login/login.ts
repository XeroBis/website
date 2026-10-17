import { Component, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthService, BrowserLocation, ENVIRONMENT, httpStatus } from '@shared';

import { redirectTarget } from '../redirect';

@Component({
  selector: 'ab-login',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe],
  template: `
    <main class="card">
      <h1>{{ 'LOGIN.TITLE' | translate }}</h1>
      <p class="subtitle">{{ 'LOGIN.SUBTITLE' | translate }}</p>
      <form [formGroup]="form" (ngSubmit)="submit()">
        <label>
          {{ 'LOGIN.EMAIL' | translate }}
          <input type="email" formControlName="email" autocomplete="username" placeholder="you@example.com" />
        </label>
        <label>
          {{ 'LOGIN.PASSWORD' | translate }}
          <input type="password" formControlName="password" autocomplete="current-password" placeholder="••••••••" />
        </label>
        <button type="submit" [disabled]="form.invalid || submitting()">
          {{ 'LOGIN.SUBMIT' | translate }}
        </button>
        @if (error()) {
          <p class="error" role="alert">{{ error() | translate }}</p>
        }
      </form>
      <p class="alt-action">
        <a routerLink="/signup" queryParamsHandling="preserve">{{ 'LOGIN.SIGNUP_LINK' | translate }}</a>
      </p>
    </main>
  `,
})
export class Login {
  /** `?redirect=`, followed after login only if allowed (see redirect.ts). */
  readonly redirect = input<string>();

  private readonly auth = inject(AuthService);
  private readonly env = inject(ENVIRONMENT);
  private readonly location = inject(BrowserLocation);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  protected readonly error = signal('');
  protected readonly submitting = signal(false);

  constructor() {
    // Already logged in (e.g. an old tab): no need to log in again.
    this.auth
      .load()
      .then((user) => user && this.leave())
      .catch(() => undefined);
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    this.submitting.set(true);
    try {
      await this.auth.login(this.form.getRawValue());
      this.leave();
    } catch (err) {
      const status = httpStatus(err);
      this.error.set(
        status === 401
          ? 'LOGIN.ERROR_INVALID'
          : status === 429
            ? 'LOGIN.ERROR_RATE_LIMITED'
            : 'LOGIN.ERROR_GENERIC',
      );
    } finally {
      this.submitting.set(false);
    }
  }

  private leave(): void {
    this.location.assign(redirectTarget(this.redirect(), this.env));
  }
}
