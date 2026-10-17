import { Component, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';

import { AuthService } from '../auth/auth.service';
import { BrowserLocation } from '../auth/browser-location';
import { HealthService } from '../health/health.service';

/**
 * Temporary landing page for an app that hasn't been migrated yet: shows the
 * app's name, whether the shared backend answers `/api/health`, and who is
 * logged in (the shared session).
 */
@Component({
  selector: 'ab-placeholder',
  template: `
    <main>
      <h1>{{ appName() }}</h1>
      <p>
        Backend:
        <strong data-testid="backend-status">{{ backend() }}</strong>
      </p>
      <p data-testid="session">
        @if (auth.user(); as user) {
          Logged in as <strong>{{ user.pseudo }}</strong> ({{ user.email }})
        } @else {
          Not logged in. <a [href]="loginUrl">Log in</a>
        }
      </p>
    </main>
  `,
  styles: `
    main {
      font-family: system-ui, sans-serif;
      max-width: 40rem;
      margin: 4rem auto;
      padding: 0 1rem;
    }
  `,
})
export class Placeholder {
  readonly appName = input.required<string>();

  protected readonly auth = inject(AuthService);
  protected readonly loginUrl = this.auth.loginUrl(inject(BrowserLocation).href);

  protected readonly backend = toSignal(
    inject(HealthService)
      .check()
      .pipe(
        map(() => 'ok'),
        catchError(() => of('unreachable')),
      ),
    { initialValue: 'checking…' },
  );

  constructor() {
    this.auth.load().catch(() => undefined);
  }
}
