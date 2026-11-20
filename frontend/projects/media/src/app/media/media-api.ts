import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';

import {
  EntryDetail,
  EntryStatus,
  EntrySummary,
  EntryUpdate,
  JournalEntry,
  JournalQuery,
  LibraryFilters,
  MediaType,
  QuickAction,
  SearchResult,
  SessionInput,
  Shelf,
} from './models';

function params(values: object): HttpParams {
  let p = new HttpParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== '') p = p.set(key, String(value));
  }
  return p;
}

/** The backend's `detail` message, or a translation key for a generic one (show it through `| translate`). */
export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const detail = error.error?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail[0]?.msg)
      return String(detail[0].msg).replace(/^Value error, /, '');
    if (error.status === 0) return 'errors.unreachable';
  }
  return 'errors.generic';
}

const API = '/api/media';

@Injectable({ providedIn: 'root' })
export class MediaApi {
  private readonly http = inject(HttpClient);

  private run<T>(request: Observable<T>): Promise<T> {
    return firstValueFrom(request);
  }

  coverUrl(mediaItemId: number): string {
    return `${API}/items/${mediaItemId}/cover`;
  }

  search(type: MediaType, q: string): Promise<SearchResult[]> {
    const params = new HttpParams().set('type', type).set('q', q);
    return this.run(this.http.get<SearchResult[]>(`${API}/search`, { params }));
  }

  addFromSearch(result: SearchResult, status: EntryStatus, owned: boolean): Promise<EntryDetail> {
    const body = {
      source: result.source,
      external_id: result.external_id,
      type: result.type,
      status,
      owned,
    };
    return this.run(this.http.post<EntryDetail>(`${API}/library/from-search`, body));
  }

  addManual(body: {
    type: MediaType;
    title: string;
    creators: string | null;
    year: number | null;
    genres: string[];
    status: EntryStatus;
    owned: boolean;
  }): Promise<EntryDetail> {
    return this.run(this.http.post<EntryDetail>(`${API}/library/manual`, body));
  }

  library(filters: LibraryFilters): Promise<EntrySummary[]> {
    return this.run(this.http.get<EntrySummary[]>(`${API}/library`, { params: params(filters) }));
  }

  genres(shelf: Shelf): Promise<string[]> {
    return this.run(
      this.http.get<string[]>(`${API}/library/genres`, { params: params({ shelf }) }),
    );
  }

  journal(query: JournalQuery): Promise<JournalEntry[]> {
    return this.run(this.http.get<JournalEntry[]>(`${API}/journal`, { params: params(query) }));
  }

  entry(id: number): Promise<EntryDetail> {
    return this.run(this.http.get<EntryDetail>(`${API}/library/${id}`));
  }

  update(id: number, changes: EntryUpdate): Promise<EntryDetail> {
    return this.run(this.http.patch<EntryDetail>(`${API}/library/${id}`, changes));
  }

  act(id: number, action: QuickAction): Promise<EntryDetail> {
    return this.run(this.http.post<EntryDetail>(`${API}/library/${id}/${action}`, {}));
  }

  remove(id: number): Promise<void> {
    return this.run(this.http.delete<void>(`${API}/library/${id}`));
  }

  addSession(id: number, session: SessionInput): Promise<EntryDetail> {
    return this.run(this.http.post<EntryDetail>(`${API}/library/${id}/sessions`, session));
  }

  updateSession(id: number, sessionId: number, session: SessionInput): Promise<EntryDetail> {
    return this.run(
      this.http.put<EntryDetail>(`${API}/library/${id}/sessions/${sessionId}`, session),
    );
  }

  deleteSession(id: number, sessionId: number): Promise<EntryDetail> {
    return this.run(this.http.delete<EntryDetail>(`${API}/library/${id}/sessions/${sessionId}`));
  }
}
