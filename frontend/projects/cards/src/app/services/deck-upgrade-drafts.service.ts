import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  DeckDetail,
  DeckExportTextFormat,
  DeckUpgradeDraft,
  DeckUpgradeDraftCreate,
  DeckUpgradeDraftDetail,
  DeckUpgradeDraftEntryUpdate,
  DeckUpgradeDraftPasteRequest,
  DeckUpgradeDraftUpdate,
  DraftExportMode,
} from '../models/deck.model';
import { VariantType } from '../models/card.model';

@Injectable({ providedIn: 'root' })
export class DeckUpgradeDraftsService {
  private readonly baseUrl = `/api/cards/decks`;

  constructor(private readonly http: HttpClient) {}

  list(deckId: number): Observable<DeckUpgradeDraft[]> {
    return this.http.get<DeckUpgradeDraft[]>(`${this.baseUrl}/${deckId}/drafts`);
  }

  create(deckId: number, payload: DeckUpgradeDraftCreate): Observable<DeckUpgradeDraftDetail> {
    return this.http.post<DeckUpgradeDraftDetail>(`${this.baseUrl}/${deckId}/drafts`, payload);
  }

  get(deckId: number, draftId: number): Observable<DeckUpgradeDraftDetail> {
    return this.http.get<DeckUpgradeDraftDetail>(`${this.baseUrl}/${deckId}/drafts/${draftId}`);
  }

  rename(
    deckId: number,
    draftId: number,
    payload: DeckUpgradeDraftUpdate,
  ): Observable<DeckUpgradeDraft> {
    return this.http.put<DeckUpgradeDraft>(`${this.baseUrl}/${deckId}/drafts/${draftId}`, payload);
  }

  delete(deckId: number, draftId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${deckId}/drafts/${draftId}`);
  }

  /** Replaces the draft's entries with the diff against a freshly pasted/uploaded
   * decklist (TCGplayer/PTCGL, Cardmarket, or a deck-export JSON). */
  replaceFromPaste(
    deckId: number,
    draftId: number,
    payload: DeckUpgradeDraftPasteRequest,
  ): Observable<DeckUpgradeDraftDetail> {
    return this.http.put<DeckUpgradeDraftDetail>(
      `${this.baseUrl}/${deckId}/drafts/${draftId}/paste`,
      payload,
    );
  }

  upsertEntry(
    deckId: number,
    draftId: number,
    catalogId: number,
    payload: DeckUpgradeDraftEntryUpdate,
    variantType: VariantType = 'standard',
  ): Observable<DeckUpgradeDraftDetail> {
    return this.http.put<DeckUpgradeDraftDetail>(
      `${this.baseUrl}/${deckId}/drafts/${draftId}/entries/${catalogId}`,
      payload,
      { params: { variant_type: variantType } },
    );
  }

  removeEntry(
    deckId: number,
    draftId: number,
    catalogId: number,
    variantType: VariantType = 'standard',
  ): Observable<DeckUpgradeDraftDetail> {
    return this.http.delete<DeckUpgradeDraftDetail>(
      `${this.baseUrl}/${deckId}/drafts/${draftId}/entries/${catalogId}`,
      { params: { variant_type: variantType } },
    );
  }

  /** Applies the draft to the real deck, all-or-nothing; on success the draft is deleted. */
  apply(deckId: number, draftId: number): Observable<DeckDetail> {
    return this.http.post<DeckDetail>(`${this.baseUrl}/${deckId}/drafts/${draftId}/apply`, {});
  }

  /** Renders the cards a draft still needs (positive-delta entries with a
   * shortfall against owned/available copies) as a copyable TCGplayer/PTCGL
   * or Cardmarket decklist -- same renderers as DecksService.exportDeckText. */
  exportDraftText(
    deckId: number,
    draftId: number,
    format: DeckExportTextFormat,
    mode: DraftExportMode,
    includeSets = true,
  ): Observable<string> {
    return this.http.get(`${this.baseUrl}/${deckId}/drafts/${draftId}/export/text`, {
      params: { format, mode, include_sets: includeSets },
      responseType: 'text',
    });
  }
}
