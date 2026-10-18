import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  Card,
  CardBulkAddRequest,
  CardCreate,
  CardFilterOptions,
  CardPage,
  CardUpdate,
  CollectionHistoryPage,
  CollectionImportResult,
  CollectionWipeResult,
  VariantType,
} from '../models/card.model';

@Injectable({ providedIn: 'root' })
export class CardsService {
  private readonly baseUrl = `/api/cards/collection`;

  constructor(private readonly http: HttpClient) {}

  list(setCode?: string): Observable<Card[]> {
    let params = new HttpParams();
    if (setCode) {
      params = params.set('set_code', setCode);
    }
    return this.http.get<Card[]>(this.baseUrl, { params });
  }

  /** Server-side filter/sort/paginate for the Collection page -- see
   * data-model.md's "Computed Values" on GET /api/cards/search. Unlike
   * list(), which always returns the whole (optionally set_code-narrowed)
   * collection for callers like set-detail/gestion that need every row. */
  search(
    options: {
      search?: string;
      setCode?: string;
      setName?: string;
      supertype?: string[];
      rarity?: string[];
      available?: '' | 'available' | 'unavailable';
      cardNumber?: string;
      /** Ownership-based: only cards with an owned copy of this variant. */
      variantType?: VariantType[];
      sort?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ): Observable<CardPage> {
    let params = new HttpParams()
      .set('page', options.page ?? 1)
      .set('page_size', options.pageSize ?? 50)
      .set('sort', options.sort ?? 'name_asc');
    if (options.search) {
      params = params.set('search', options.search);
    }
    if (options.setCode) {
      params = params.set('set_code', options.setCode);
    }
    if (options.setName) {
      params = params.set('set_name', options.setName);
    }
    for (const value of options.supertype ?? []) {
      params = params.append('supertype', value);
    }
    for (const value of options.rarity ?? []) {
      params = params.append('rarity', value);
    }
    if (options.available) {
      params = params.set('available', options.available);
    }
    if (options.cardNumber) {
      params = params.set('card_number', options.cardNumber);
    }
    for (const value of options.variantType ?? []) {
      params = params.append('variant_type', value);
    }
    return this.http.get<CardPage>(`${this.baseUrl}/search`, { params });
  }

  filterOptions(): Observable<CardFilterOptions> {
    return this.http.get<CardFilterOptions>(`${this.baseUrl}/filter-options`);
  }

  get(cardId: number): Observable<Card> {
    return this.http.get<Card>(`${this.baseUrl}/${cardId}`);
  }

  add(payload: CardCreate): Observable<Card> {
    return this.http.post<Card>(this.baseUrl, payload);
  }

  bulkAdd(payload: CardBulkAddRequest): Observable<Card[]> {
    return this.http.post<Card[]>(`${this.baseUrl}/bulk`, payload);
  }

  /** Returns null when the updated variant (and, if it was the last one,
   * the whole card) was deleted -- see data-model.md's
   * `card_variant_quantities`. */
  update(cardId: number, payload: CardUpdate): Observable<Card | null> {
    return this.http.put<Card | null>(`${this.baseUrl}/${cardId}`, payload);
  }

  delete(cardId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${cardId}`);
  }

  /** Wipes the entire collection: all cards, decks, and combat history. */
  deleteAll(): Observable<CollectionWipeResult> {
    return this.http.delete<CollectionWipeResult>(this.baseUrl);
  }

  exportCollection(): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/export`, { responseType: 'blob' });
  }

  /** All-or-nothing: rejects with 409/422 and adds nothing if any card is invalid. */
  importCollection(data: unknown): Observable<CollectionImportResult> {
    return this.http.post<CollectionImportResult>(`${this.baseUrl}/import`, data);
  }

  history(page: number, pageSize = 50, search?: string): Observable<CollectionHistoryPage> {
    let params = new HttpParams().set('page', page).set('page_size', pageSize);
    if (search) {
      params = params.set('search', search);
    }
    return this.http.get<CollectionHistoryPage>(`${this.baseUrl}/history`, { params });
  }
}
