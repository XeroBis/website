import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';

import { AuthService } from '@shared';

import { WorkoutApi } from './api';
import { WorkoutUser } from './models';

/**
 * Whose data a page shows (read-only sharing): `?user=<id>` in the URL, else
 * the current user. Provide it per page (`providers: [Viewing]`).
 */
@Injectable()
export class Viewing {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly users = signal<WorkoutUser[]>([]);
  private readonly param = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((p) => Number(p.get('user')) || null)),
    { initialValue: null },
  );

  /** The viewed user's id. */
  readonly userId = computed(() => this.param() ?? this.auth.user()?.id ?? null);
  /** Whether it's the current user (so editing is allowed). */
  readonly isOwn = computed(() => this.userId() === this.auth.user()?.id);
  /** For API calls: null for yourself. */
  readonly queryUserId = computed(() => (this.isOwn() ? null : this.userId()));

  constructor() {
    inject(WorkoutApi)
      .users()
      .then((users) => this.users.set(users))
      .catch(() => undefined);
  }

  select(userId: number): void {
    const own = userId === this.auth.user()?.id;
    this.router.navigate([], {
      queryParams: { user: own ? null : userId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
