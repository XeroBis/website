import { Component, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthService, BrowserLocation, ENVIRONMENT } from '@shared';

import { httpStatus } from '../http-error';
import { redirectTarget } from '../redirect';

const ERRORS: Record<number, string> = {
  403: 'SIGNUP.ERROR_CODE',
  409: 'SIGNUP.ERROR_EMAIL_TAKEN',
  422: 'SIGNUP.ERROR_INVALID',
  429: 'SIGNUP.ERROR_RATE_LIMITED',
};

/** Invite-only sign-up (needs the sign-up code); logs the new user in. */
@Component({
  selector: 'ab-signup',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe],
  template: `
    <main class="card">
      <h1>{{ 'SIGNUP.TITLE' | translate }}</h1>
      <p class="subtitle">{{ 'SIGNUP.SUBTITLE' | translate }}</p>
      <form [formGroup]="form" (ngSubmit)="submit()">
        <label>
          {{ 'SIGNUP.EMAIL' | translate }}
          <input type="email" formControlName="email" autocomplete="username" placeholder="you@example.com" />
        </label>
        <label>
          {{ 'SIGNUP.PASSWORD' | translate }}
          <input type="password" formControlName="password" autocomplete="new-password" placeholder="••••••••••••" />
          <span class="hint">{{ 'SIGNUP.PASSWORD_HINT' | translate }}</span>
        </label>
        <label>
          {{ 'SIGNUP.PSEUDO' | translate }}
          <input
            type="text"
            formControlName="pseudo"
            autocomplete="nickname"
            maxlength="50"
            [placeholder]="'SIGNUP.PSEUDO_PLACEHOLDER' | translate"
          />
        </label>
        <label>
          {{ 'SIGNUP.CODE' | translate }}
          <input
            type="password"
            formControlName="code"
            autocomplete="off"
            [placeholder]="'SIGNUP.CODE_PLACEHOLDER' | translate"
          />
        </label>
        <button type="submit" [disabled]="form.invalid || submitting()">
          {{ 'SIGNUP.SUBMIT' | translate }}
        </button>
        @if (error()) {
          <p class="error" role="alert">{{ error() | translate }}</p>
        }
      </form>
      <p class="alt-action">
        <a routerLink="/login" queryParamsHandling="preserve">{{ 'SIGNUP.LOGIN_LINK' | translate }}</a>
      </p>
    </main>
  `,
})
export class Signup {
  readonly redirect = input<string>();

  private readonly auth = inject(AuthService);
  private readonly env = inject(ENVIRONMENT);
  private readonly location = inject(BrowserLocation);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(12)]],
    pseudo: ['', [Validators.required, Validators.maxLength(50), Validators.pattern(/\S/)]],
    code: ['', Validators.required],
  });
  protected readonly error = signal('');
  protected readonly submitting = signal(false);

  protected async submit(): Promise<void> {
    const { code, ...details } = this.form.getRawValue();
    this.error.set('');
    this.submitting.set(true);
    try {
      await this.auth.register(details, code);
      this.location.assign(redirectTarget(this.redirect(), this.env));
    } catch (err) {
      this.error.set(ERRORS[httpStatus(err)] ?? 'SIGNUP.ERROR_GENERIC');
    } finally {
      this.submitting.set(false);
    }
  }
}
