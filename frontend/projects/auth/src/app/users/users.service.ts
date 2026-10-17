import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AdminUser, GrantableApp } from '@shared';

/** Admin-only `/api/auth/users`: every account and its app access. */
@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly http = inject(HttpClient);

  list(): Promise<AdminUser[]> {
    return firstValueFrom(this.http.get<AdminUser[]>('/api/auth/users'));
  }

  /** Replaces the user's grants; answers with the updated user. */
  setApps(userId: number, apps: GrantableApp[]): Promise<AdminUser> {
    return firstValueFrom(this.http.put<AdminUser>(`/api/auth/users/${userId}/apps`, { apps }));
  }
}
