import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  Deck,
  DeckBulkAddRequest,
  DeckCardUpdate,
  DeckCombatOption,
  DeckCopyRequest,
  DeckCreate,
  DeckDetail,
  DeckExport,
  DeckExportMode,
  DeckExportTextFormat,
  DeckFromPasteRequest,
  DeckHistoryPage,
  DeckUpdate,
  DeckWipeResult,
} from '../models/deck.model';
import { VariantType } from '../models/card.model';

@Injectable({ providedIn: 'root' })
export class DecksService {
  private readonly baseUrl = `/api/cards/decks`;

  constructor(private readonly http: HttpClient) {}

  list(): Observable<Deck[]> {
    return this.http.get<Deck[]>(this.baseUrl);
  }

  /** Every user's decks, read-only (name/type/owner only) -- for the Combat
   * Log's deck pickers, the one place decks are visible across users. */
  listForCombat(): Observable<DeckCombatOption[]> {
    return this.http.get<DeckCombatOption[]>(`${this.baseUrl}/combat-options`);
  }

  get(deckId: number): Observable<DeckDetail> {
    return this.http.get<DeckDetail>(`${this.baseUrl}/${deckId}`);
  }

  create(payload: DeckCreate): Observable<Deck> {
    return this.http.post<Deck>(this.baseUrl, payload);
  }

  update(deckId: number, payload: DeckUpdate): Observable<Deck> {
    return this.http.put<Deck>(`${this.baseUrl}/${deckId}`, payload);
  }

  delete(deckId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${deckId}`);
  }

  updateCard(deckId: number, rowId: number, payload: DeckCardUpdate): Observable<unknown> {
    return this.http.put(`${this.baseUrl}/${deckId}/cards/${rowId}`, payload);
  }

  removeCard(deckId: number, rowId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${deckId}/cards/${rowId}`);
  }

  bulkAddCards(deckId: number, payload: DeckBulkAddRequest): Observable<DeckDetail> {
    return this.http.post<DeckDetail>(`${this.baseUrl}/${deckId}/cards/bulk`, payload);
  }

  /** Phantom-deck only: merges pasted decklist lines into the deck's want-list. */
  addFromPaste(deckId: number, payload: DeckFromPasteRequest): Observable<DeckDetail> {
    return this.http.post<DeckDetail>(`${this.baseUrl}/${deckId}/cards/from-paste`, payload);
  }

  /** `mode` only filters a phantom deck's want-list -- see the backend's
   * `export_deck` docstring. Ignored (always full) for normal decks.
   * Returns the parsed data rather than a blob so the caller can build the
   * downloaded JSON file client-side -- see DeckActionsComponent.doExport.
   * For TCGPlayer/Cardmarket text instead, see exportDeckText below. */
  exportDeck(deckId: number, mode: DeckExportMode = 'full'): Observable<DeckExport> {
    return this.http.get<DeckExport>(`${this.baseUrl}/${deckId}/export`, { params: { mode } });
  }

  /** Renders the deck as a copyable TCGplayer/PTCGL or Cardmarket decklist --
   * the exact same format the Decklist Converter produces, generated
   * server-side so ability/attack disambiguator brackets and Cardmarket's
   * expansion-name cleanup stay in one place. */
  exportDeckText(
    deckId: number,
    format: DeckExportTextFormat,
    mode: DeckExportMode = 'full',
  ): Observable<string> {
    return this.http.get(`${this.baseUrl}/${deckId}/export/text`, {
      params: { format, mode },
      responseType: 'text',
    });
  }

  copy(deckId: number, payload: DeckCopyRequest): Observable<Deck> {
    return this.http.post<Deck>(`${this.baseUrl}/${deckId}/copy`, payload);
  }

  history(deckId: number, page: number, pageSize = 50): Observable<DeckHistoryPage> {
    const params = { page: String(page), page_size: String(pageSize) };
    return this.http.get<DeckHistoryPage>(`${this.baseUrl}/${deckId}/history`, { params });
  }

  importDeck(data: unknown): Observable<Deck> {
    return this.http.post<Deck>(`${this.baseUrl}/import`, data);
  }

  exportAllDecks(): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/export`, { responseType: 'blob' });
  }

  importAllDecks(data: unknown): Observable<Deck[]> {
    return this.http.post<Deck[]>(`${this.baseUrl}/import-all`, data);
  }

  deleteAll(): Observable<DeckWipeResult> {
    return this.http.delete<DeckWipeResult>(this.baseUrl);
  }
}
