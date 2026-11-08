import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { VariantType } from '../models/card.model';
import { OnSalePrint, SaleList, SaleListDetail } from '../models/sale-list.model';

@Injectable({ providedIn: 'root' })
export class SaleListsService {
  private readonly baseUrl = `/api/cards/sale-lists`;

  constructor(private readonly http: HttpClient) {}

  list(): Observable<SaleList[]> {
    return this.http.get<SaleList[]>(this.baseUrl);
  }

  get(id: number): Observable<SaleListDetail> {
    return this.http.get<SaleListDetail>(`${this.baseUrl}/${id}`);
  }

  create(name: string): Observable<SaleListDetail> {
    return this.http.post<SaleListDetail>(this.baseUrl, { name });
  }

  /** Copies per print on unsold lists. */
  onSale(): Observable<OnSalePrint[]> {
    return this.http.get<OnSalePrint[]>(`${this.baseUrl}/on-sale`);
  }

  rename(id: number, name: string): Observable<SaleListDetail> {
    return this.http.put<SaleListDetail>(`${this.baseUrl}/${id}`, { name });
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  sell(id: number): Observable<SaleListDetail> {
    return this.http.post<SaleListDetail>(`${this.baseUrl}/${id}/sell`, {});
  }

  /** Several cards at once, all or nothing; repeats add up. */
  addCards(
    id: number,
    items: { catalog_id: number; variant_type: VariantType; quantity: number }[],
  ): Observable<SaleListDetail> {
    return this.http.post<SaleListDetail>(`${this.baseUrl}/${id}/cards/bulk`, { items });
  }

  updateCard(
    id: number,
    rowId: number,
    variantType: VariantType,
    quantity: number,
  ): Observable<SaleListDetail> {
    return this.http.put<SaleListDetail>(`${this.baseUrl}/${id}/cards/${rowId}`, {
      variant_type: variantType,
      quantity,
    });
  }

  removeCard(id: number, rowId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}/cards/${rowId}`);
  }
}
