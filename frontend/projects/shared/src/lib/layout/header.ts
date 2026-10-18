import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthService } from '../auth/auth.service';
import { BrowserLocation } from '../auth/browser-location';
import { ENVIRONMENT } from '../environment/environment.token';
import { LanguageService } from '../i18n/i18n';
import { LANGUAGES, Language } from '../i18n/language';
import { Icon, IconName } from '../icon/icon';
import { THEMES, Theme } from '../theme/theme';
import { ThemeService } from '../theme/theme.service';

/**
 * Top bar for every app: the app's title (link home), the app's own links
 * (projected content), a FR/EN switch, a theme button cycling System →
 * Light → Dark, and the session: pseudo + a link to
 * the auth app's account page (where logging out happens), or a log in link
 * coming back to the current page. On phones (≤ 720px) everything but the
 * title folds into a menu opened by a button. Needs `provideI18n`.
 */
@Component({
  selector: 'ab-header',
  imports: [Icon, RouterLink, TranslatePipe],
  host: { '(document:keydown.escape)': 'open.set(false)' },
  template: `
    <header [class.open]="open()">
      <a class="title" routerLink="/" (click)="open.set(false)">{{ title() }}</a>
      <button
        type="button"
        class="menu-toggle"
        aria-controls="ab-header-menu"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="'SHARED.MENU' | translate"
        (click)="open.set(!open())"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          @if (open()) {
            <path d="M6 6l12 12M18 6L6 18"></path>
          } @else {
            <path d="M4 7h16M4 12h16M4 17h16"></path>
          }
        </svg>
      </button>
      <!-- Desktop: display: contents, so its children sit in the header's row. -->
      <div class="menu" id="ab-header-menu" (click)="closeOnLink($event)">
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
        @let themeLabel = 'SHARED.THEME' | translate: { name: themeName() | translate };
        <button
          type="button"
          class="theme"
          [attr.aria-label]="themeLabel"
          [title]="themeLabel"
          [disabled]="themeBusy()"
          (click)="cycleTheme()"
        >
          <ab-icon [name]="themeIcon()" />
        </button>
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
    .theme {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      padding: 0;
      color: var(--ab-muted, #8a8a80);
      font-size: 16px;
    }
    .theme:hover:not(:disabled) {
      color: var(--ab-text, #1c1c1e);
      border-color: var(--ab-border, #eceae4);
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
    .menu {
      display: contents;
    }
    .menu-toggle {
      display: none;
    }
    @media (max-width: 720px) {
      header {
        gap: 0.5rem;
        padding: 0.5rem 0.75rem 0.5rem 1rem;
      }
      .title {
        margin-right: auto;
      }
      .menu-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2.5rem;
        height: 2.5rem;
        padding: 0;
      }
      .menu {
        display: none;
      }
      header.open .menu {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.75rem 1rem;
        flex-basis: 100%;
        max-height: calc(100dvh - 4rem);
        overflow-y: auto;
        padding: 0.5rem 0 0.25rem;
        border-top: 1px solid var(--ab-border, #eceae4);
      }
      .links {
        flex-basis: 100%;
        flex-direction: column;
        align-items: stretch;
        gap: 0.15rem;
        margin-right: 0;
      }
      .session {
        margin-left: auto;
      }
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

  protected readonly theme = inject(ThemeService);

  protected readonly languages = LANGUAGES;
  protected readonly busy = signal(false);
  protected readonly themeBusy = signal(false);
  protected readonly themeIcon = computed(() => THEME_ICONS[this.theme.current()]);
  protected readonly themeName = computed(() => `SHARED.THEME_${this.theme.current().toUpperCase()}`);
  /** The phone menu. */
  protected readonly open = signal(false);

  /** Computed on use, so it returns to the page currently shown. */
  protected loginUrl(): string {
    return this.auth.loginUrl(this.location.href);
  }

  /** A tapped link navigates (or leaves), so the phone menu closes. */
  protected closeOnLink(event: Event): void {
    if ((event.target as Element).closest('a')) this.open.set(false);
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

  protected async cycleTheme(): Promise<void> {
    const next = THEMES[(THEMES.indexOf(this.theme.current()) + 1) % THEMES.length];
    this.themeBusy.set(true);
    try {
      await this.theme.change(next);
    } catch {
      // Not saved: the account keeps its old theme.
    } finally {
      this.themeBusy.set(false);
    }
  }
}

const THEME_ICONS: Record<Theme, IconName> = { system: 'monitor', light: 'sun', dark: 'moon' };
