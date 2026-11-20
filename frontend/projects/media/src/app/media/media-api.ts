import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';

import { Language } from '@shared';

import {
  AddOptions,
  BookDetailsInput,
  BookSeries,
  BookSeriesDetail,
  EntryDetail,
  EntryStatus,
  EntrySummary,
  EntryUpdate,
  JournalEntry,
  JournalQuery,
  LibraryFilters,
  MediaItem,
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

  /** Versioned by `updated_at`, so a replaced cover gets a new URL. */
  coverUrl(item: Pick<MediaItem, 'id' | 'updated_at'>): string {
    return `${API}/items/${item.id}/cover?v=${Date.parse(item.updated_at) || 0}`;
  }

  /** Replaces the item's cover (for everyone who has it) with a file from the device. */
  uploadCover(entryId: number, file: Blob): Promise<EntryDetail> {
    return this.run(
      this.http.put<EntryDetail>(`${API}/library/${entryId}/cover`, file, {
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      }),
    );
  }

  /** Same, from an image URL the server downloads. */
  coverFromUrl(entryId: number, url: string): Promise<EntryDetail> {
    return this.run(
      this.http.post<EntryDetail>(`${API}/library/${entryId}/cover/from-url`, { url }),
    );
  }

  /**
   * `page` > 1 (Google Books' next 20) and `lang` (the editions' language,
   * default the user's) are for books only, as is `isbn`, which overrides `q`
   * and `lang`.
   */
  search(
    type: MediaType,
    q: string,
    page = 1,
    lang: Language | null = null,
    isbn: string | null = null,
  ): Promise<SearchResult[]> {
    return this.run(
      this.http.get<SearchResult[]>(`${API}/search`, {
        params: params({ type, q, isbn, page: page > 1 ? page : null, lang }),
      }),
    );
  }

  addFromSearch(result: SearchResult, options: AddOptions): Promise<EntryDetail> {
    const body = {
      source: result.source,
      external_id: result.external_id,
      type: result.type,
      ...options,
    };
    return this.run(this.http.post<EntryDetail>(`${API}/library/from-search`, body));
  }

  addManual(
    body: {
      type: MediaType;
      title: string;
      creators: string | null;
      year: number | null;
      genres: string[];
    } & AddOptions,
  ): Promise<EntryDetail> {
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

  /** Edits a book's catalog row (for everyone who has it). */
  editBookDetails(id: number, details: BookDetailsInput): Promise<EntryDetail> {
    return this.run(this.http.put<EntryDetail>(`${API}/library/${id}/item`, details));
  }

  /** `undated` (finish only): the read has no date. */
  act(id: number, action: QuickAction, undated = false): Promise<EntryDetail> {
    return this.run(
      this.http.post<EntryDetail>(
        `${API}/library/${id}/${action}`,
        {},
        { params: params({ undated: undated || null }) },
      ),
    );
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

  allSeries(): Promise<BookSeries[]> {
    return this.run(this.http.get<BookSeries[]>(`${API}/series`));
  }

  createSeries(name: string): Promise<BookSeries> {
    return this.run(this.http.post<BookSeries>(`${API}/series`, { name }));
  }

  series(id: number): Promise<BookSeriesDetail> {
    return this.run(this.http.get<BookSeriesDetail>(`${API}/series/${id}`));
  }

  renameSeries(id: number, name: string): Promise<BookSeriesDetail> {
    return this.run(this.http.patch<BookSeriesDetail>(`${API}/series/${id}`, { name }));
  }

  deleteSeries(id: number): Promise<void> {
    return this.run(this.http.delete<void>(`${API}/series/${id}`));
  }
}
