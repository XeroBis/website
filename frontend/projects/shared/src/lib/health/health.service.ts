import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface Health {
  status: 'ok';
}

/** `GET /api/health` — same-origin on every host (proxied to the backend). */
@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(HttpClient);

  check(): Observable<Health> {
    return this.http.get<Health>('/api/health');
  }
}
