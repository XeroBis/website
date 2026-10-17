import { Component, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';

import { HealthService } from '../health/health.service';

/**
 * Temporary landing page for an app that hasn't been migrated yet: shows the
 * app's name and whether the shared backend answers `/api/health`.
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

  protected readonly backend = toSignal(
    inject(HealthService)
      .check()
      .pipe(
        map(() => 'ok'),
        catchError(() => of('unreachable')),
      ),
    { initialValue: 'checking…' },
  );
}
