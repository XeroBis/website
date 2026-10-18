import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  DeckExportTextFormat,
  DraftExportMode,
  DraftPickerItem,
  MultiDraftExportRequest,
} from '../models/deck.model';

/** Cross-deck "combine drafts" export -- see DeckUpgradeDraftsService for
 * the single-draft equivalent this pools demand across multiple drafts
 * (possibly from different decks) instead of. */
@Injectable({ providedIn: 'root' })
export class DraftExportService {
  private readonly baseUrl = `/api/cards/drafts`;

  constructor(private readonly http: HttpClient) {}

  listAll(): Observable<DraftPickerItem[]> {
    return this.http.get<DraftPickerItem[]>(this.baseUrl);
  }

  exportText(
    payload: MultiDraftExportRequest,
    format: DeckExportTextFormat,
    mode: DraftExportMode,
    includeSets = true,
    language: 'en' | 'fr' = 'en',
  ): Observable<string> {
    return this.http.post(`${this.baseUrl}/export/text`, payload, {
      params: { format, mode, include_sets: includeSets, language },
      responseType: 'text',
    });
  }
}
