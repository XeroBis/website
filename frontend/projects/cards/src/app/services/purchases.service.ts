import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  Purchase,
  PurchaseCreate,
  PurchaseUpdate,
  PurchaseWipeResult,
} from '../models/purchase.model';

@Injectable({ providedIn: 'root' })
export class PurchasesService {
  private readonly baseUrl = `/api/cards/purchases`;

  constructor(private readonly http: HttpClient) {}

  list(): Observable<Purchase[]> {
    return this.http.get<Purchase[]>(this.baseUrl);
  }

  create(payload: PurchaseCreate): Observable<Purchase> {
    return this.http.post<Purchase>(this.baseUrl, payload);
  }

  update(purchaseId: number, payload: PurchaseUpdate): Observable<Purchase> {
    return this.http.put<Purchase>(`${this.baseUrl}/${purchaseId}`, payload);
  }

  delete(purchaseId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${purchaseId}`);
  }

  exportAll(): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/export`, { responseType: 'blob' });
  }

  importAll(data: unknown): Observable<Purchase[]> {
    return this.http.post<Purchase[]>(`${this.baseUrl}/import-all`, data);
  }

  deleteAll(): Observable<PurchaseWipeResult> {
    return this.http.delete<PurchaseWipeResult>(this.baseUrl);
  }
}
