import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';

import { AuthService } from '../auth/auth.service';
import { readCookie } from '../auth/cookies';
import { ENVIRONMENT } from '../environment/environment.token';
import { THEME_COOKIE, Theme, applyTheme, resolveTheme } from './theme';

const ONE_YEAR = 365 * 24 * 60 * 60;

/** The theme every app is shown in; see `resolveTheme` for the order. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly auth = inject(AuthService);
  private readonly env = inject(ENVIRONMENT);
  private readonly document = inject(DOCUMENT);
  private readonly stored = signal(readCookie(THEME_COOKIE, this.document.cookie));

  readonly current = computed(() => resolveTheme(this.auth.user()?.theme, this.stored()));

  constructor() {
    effect(() => {
      const theme = this.current();
      applyTheme(this.document, theme);
      this.writeCookie(theme);
    });
  }

  /**
   * The theme picked in a UI switch: remembered for every site, and saved
   * on the account when logged in (a failed save is passed on).
   */
  async change(theme: Theme): Promise<void> {
    this.stored.set(theme);
    if (this.auth.user() && this.auth.user()?.theme !== theme) {
      await this.auth.updateTheme(theme);
    }
  }

  private writeCookie(theme: Theme): void {
    const domain = this.env.cookieDomain ? `; Domain=${this.env.cookieDomain}` : '';
    const secure = this.env.production ? '; Secure' : '';
    this.document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${domain}${secure}`;
  }
}
