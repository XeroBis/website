import { Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthService } from '../auth/auth.service';
import { BrowserLocation } from '../auth/browser-location';
import { ENVIRONMENT } from '../environment/environment.token';
import { LanguageService } from '../i18n/i18n';
import { LANGUAGES, Language } from '../i18n/language';

/**
 * Top bar for every app: the app's title (link home), the app's own links
 * (projected content), a FR/EN switch, and the session: pseudo + a link to
 * the auth app's account page (where logging out happens), or a log in link
 * coming back to the current page. Needs `provideI18n`.
 */
@Component({
  selector: 'ab-header',
  imports: [RouterLink, TranslatePipe],
  template: `
    <header>
      <a class="title" routerLink="/">{{ title() }}</a>
      <nav class="links"><ng-content /></nav>
      <div class="languages" role="group" [attr.aria-label]="'SHARED.LANGUAGE' | translate">
        @for (lang of languages; track lang) {
          <button
            type="button"
            [class.active]="language.current() === lang"
            [attr.aria-pressed]="language.current() === lang"
            [disabled]="busy()"
            (click)="setLanguage(lang)"
          >
            {{ lang.toUpperCase() }}
          </button>
        }
      </div>
      <div class="session">
        @if (auth.user(); as user) {
          <span class="pseudo" data-testid="pseudo">{{ user.pseudo }}</span>
          <!-- Grid icon, as on the old workout app's navbar. -->
          <a
            class="account"
            [href]="accountUrl"
            [attr.aria-label]="'SHARED.ACCOUNT' | translate"
            [title]="'SHARED.ACCOUNT' | translate"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="7" rx="1"></rect>
              <rect x="14" y="3" width="7" height="7" rx="1"></rect>
              <rect x="3" y="14" width="7" height="7" rx="1"></rect>
              <rect x="14" y="14" width="7" height="7" rx="1"></rect>
            </svg>
          </a>
        } @else {
          <a class="login" [href]="loginUrl()">{{ 'SHARED.LOGIN' | translate }}</a>
        }
      </div>
    </header>
  `,
  styles: `
    header {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
      padding: 0.75rem 1.25rem;
      border-bottom: 1px solid var(--ab-border, #eceae4);
      background: var(--ab-surface, #fff);
      font-family: inherit;
      font-size: 0.9rem;
    }
    a,
    button {
      color: inherit;
      font: inherit;
    }
    .title {
      font-weight: 700;
      text-decoration: none;
    }
    .links {
      display: flex;
      gap: 0.75rem;
      margin-right: auto;
    }
    .languages {
      display: flex;
      gap: 0.25rem;
    }
    button {
      padding: 0.2rem 0.5rem;
      border: 1px solid transparent;
      border-radius: 6px;
      background: none;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.6;
      cursor: default;
    }
    .languages .active {
      border-color: var(--ab-border, #eceae4);
      font-weight: 700;
    }
    .session {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .pseudo {
      font-weight: 600;
    }
    .login {
      color: var(--ab-accent, #b45309);
      font-weight: 600;
    }
    .account {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 30px;
      height: 30px;
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--ab-muted, #8a8a80);
      transition:
        color 0.15s,
        border-color 0.15s;
    }
    .account:hover {
      color: var(--ab-text, #1c1c1e);
      border-color: var(--ab-accent, #b45309);
    }
  `,
})
export class Header {
  /** Shown on the left, links to the app's root. */
  readonly title = input.required<string>();

  protected readonly auth = inject(AuthService);
  protected readonly language = inject(LanguageService);
  private readonly location = inject(BrowserLocation);
  protected readonly accountUrl = `${inject(ENVIRONMENT).appUrls.auth}/`;

  protected readonly languages = LANGUAGES;
  protected readonly busy = signal(false);

  /** Computed on use, so it returns to the page currently shown. */
  protected loginUrl(): string {
    return this.auth.loginUrl(this.location.href);
  }

  protected async setLanguage(lang: Language): Promise<void> {
    this.busy.set(true);
    try {
      await this.language.change(lang);
    } catch {
      // Not saved: the account keeps its old language.
    } finally {
      this.busy.set(false);
    }
  }
}
