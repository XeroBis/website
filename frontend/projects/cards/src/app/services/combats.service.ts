import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { Combat, CombatCreate, CombatUpdate, CombatWipeResult } from '../models/combat.model';

@Injectable({ providedIn: 'root' })
export class CombatsService {
  private readonly baseUrl = `/api/cards/combats`;

  constructor(private readonly http: HttpClient) {}

  list(): Observable<Combat[]> {
    return this.http.get<Combat[]>(this.baseUrl);
  }

  create(payload: CombatCreate): Observable<Combat> {
    return this.http.post<Combat>(this.baseUrl, payload);
  }

  update(combatId: number, payload: CombatUpdate): Observable<Combat> {
    return this.http.put<Combat>(`${this.baseUrl}/${combatId}`, payload);
  }

  delete(combatId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${combatId}`);
  }

  exportAll(): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/export`, { responseType: 'blob' });
  }

  importAll(data: unknown): Observable<Combat[]> {
    return this.http.post<Combat[]>(`${this.baseUrl}/import-all`, data);
  }

  deleteAll(): Observable<CombatWipeResult> {
    return this.http.delete<CombatWipeResult>(this.baseUrl);
  }
}
