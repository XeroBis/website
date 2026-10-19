import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { VariantType } from '../models/card.model';
import {
  CardmarketImportResult,
  CardmarketPreview,
  IncomingPrint,
  PurchaseList,
  PurchaseListDetail,
} from '../models/purchase-list.model';

@Injectable({ providedIn: 'root' })
export class PurchaseListsService {
  private readonly baseUrl = `/api/cards/purchase-lists`;

  constructor(private readonly http: HttpClient) {}

  list(): Observable<PurchaseList[]> {
    return this.http.get<PurchaseList[]>(this.baseUrl);
  }

  get(id: number): Observable<PurchaseListDetail> {
    return this.http.get<PurchaseListDetail>(`${this.baseUrl}/${id}`);
  }

  /** An empty list; with a price, also its What I Paid entry. */
  create(body: {
    name: string;
    purchased_at: string;
    price: string | null;
  }): Observable<PurchaseListDetail> {
    return this.http.post<PurchaseListDetail>(this.baseUrl, body);
  }

  /** Copies per print on incoming lists, for one set or all. */
  incoming(setCode?: string): Observable<IncomingPrint[]> {
    const params = setCode ? new HttpParams().set('set_code', setCode) : undefined;
    return this.http.get<IncomingPrint[]>(`${this.baseUrl}/incoming`, { params });
  }

  previewCardmarket(html: string): Observable<CardmarketPreview> {
    return this.http.post<CardmarketPreview>(`${this.baseUrl}/cardmarket/preview`, { html });
  }

  importCardmarket(body: {
    html: string;
    name: string;
    purchased_at: string;
    price: string;
  }): Observable<CardmarketImportResult> {
    return this.http.post<CardmarketImportResult>(`${this.baseUrl}/cardmarket`, body);
  }

  rename(id: number, name: string): Observable<PurchaseListDetail> {
    return this.http.put<PurchaseListDetail>(`${this.baseUrl}/${id}`, { name });
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  receive(id: number): Observable<PurchaseListDetail> {
    return this.http.post<PurchaseListDetail>(`${this.baseUrl}/${id}/receive`, {});
  }

  addCard(
    id: number,
    catalogId: number,
    variantType: VariantType,
    quantity: number,
  ): Observable<PurchaseListDetail> {
    return this.http.post<PurchaseListDetail>(`${this.baseUrl}/${id}/cards`, {
      catalog_id: catalogId,
      variant_type: variantType,
      quantity,
    });
  }

  updateCard(
    id: number,
    rowId: number,
    variantType: VariantType,
    quantity: number,
  ): Observable<PurchaseListDetail> {
    return this.http.put<PurchaseListDetail>(`${this.baseUrl}/${id}/cards/${rowId}`, {
      variant_type: variantType,
      quantity,
    });
  }

  removeCard(id: number, rowId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}/cards/${rowId}`);
  }
}
