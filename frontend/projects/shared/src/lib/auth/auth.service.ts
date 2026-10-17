import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, finalize, firstValueFrom, shareReplay } from 'rxjs';

import { ENVIRONMENT } from '../environment/environment.token';
import { Language } from '../i18n/language';
import { Credentials, Registration, User } from './user';

/**
 * The session shared by every app: same cookies on every host (see
 * documentation/architecture.md "Request flow"). `user` is null when logged
 * out or not loaded yet; `load()` resolves once `/api/auth/me` has answered.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly env = inject(ENVIRONMENT);

  private readonly _user = signal<User | null>(null);
  readonly user = this._user.asReadonly();
  readonly isLoggedIn = computed(() => this._user() !== null);
  readonly isAdmin = computed(() => this._user()?.is_admin ?? false);

  private loaded: Promise<User | null> | null = null;
  private refreshing: Observable<void> | null = null;

  /** The current user, fetched once (later calls reuse the first answer). */
  load(): Promise<User | null> {
    this.loaded ??= firstValueFrom(this.http.get<User>('/api/auth/me')).then(
      (user) => this.set(user),
      (err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 401) return this.set(null);
        this.loaded = null; // network/server error: try again next time
        throw err;
      },
    );
    return this.loaded;
  }

  async login(credentials: Credentials): Promise<User> {
    return this.set(await firstValueFrom(this.http.post<User>('/api/auth/login', credentials)));
  }

  /** Invite-only: `code` is the backend's REGISTER_SECRET. Logs the user in. */
  async register(details: Registration, code: string): Promise<User> {
    const user = await firstValueFrom(
      this.http.post<User>('/api/auth/register', details, {
        headers: { 'X-Register-Secret': code },
      }),
    );
    return this.set(user);
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post<void>('/api/auth/logout', null));
    } finally {
      this.clear();
    }
  }

  async updatePseudo(pseudo: string): Promise<User> {
    return this.set(await firstValueFrom(this.http.patch<User>('/api/auth/me', { pseudo })));
  }

  async updateLanguage(language: Language): Promise<User> {
    return this.set(
      await firstValueFrom(this.http.patch<User>('/api/auth/me/language', { language })),
    );
  }

  /** Rotates the session; concurrent callers share one request. */
  refresh(): Observable<void> {
    this.refreshing ??= this.http.post<void>('/api/auth/refresh', null).pipe(
      finalize(() => (this.refreshing = null)),
      shareReplay(1),
    );
    return this.refreshing;
  }

  /** Forget the user locally (the session is gone server-side). */
  clear(): void {
    this.set(null);
  }

  /** The auth app's login page, coming back to `returnTo` afterwards. */
  loginUrl(returnTo: string): string {
    return `${this.env.appUrls.auth}/login?redirect=${encodeURIComponent(returnTo)}`;
  }

  private set<T extends User | null>(user: T): T {
    this._user.set(user);
    this.loaded = Promise.resolve(user);
    return user;
  }
}
