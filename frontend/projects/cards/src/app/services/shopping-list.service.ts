import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  ShoppingListCard,
  ShoppingList,
  ShoppingListDetail,
  ShoppingListPasteResult,
} from '../models/shopping-list.model';

@Injectable({ providedIn: 'root' })
export class ShoppingListService {
  private readonly baseUrl = `/api/cards/shopping-lists`;

  constructor(private readonly http: HttpClient) {}

  list(): Observable<ShoppingList[]> {
    return this.http.get<ShoppingList[]>(this.baseUrl);
  }

  get(id: number): Observable<ShoppingListDetail> {
    return this.http.get<ShoppingListDetail>(`${this.baseUrl}/${id}`);
  }

  create(name: string, decklistText?: string): Observable<ShoppingListPasteResult> {
    return this.http.post<ShoppingListPasteResult>(this.baseUrl, {
      name,
      decklist_text: decklistText || null,
    });
  }

  rename(id: number, name: string): Observable<ShoppingListDetail> {
    return this.http.put<ShoppingListDetail>(`${this.baseUrl}/${id}`, { name });
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  pasteMore(id: number, decklistText: string): Observable<ShoppingListPasteResult> {
    return this.http.post<ShoppingListPasteResult>(`${this.baseUrl}/${id}/paste`, {
      decklist_text: decklistText,
    });
  }

  updateCardQuantity(
    shoppingListId: number,
    cardId: number,
    quantityOwned: number,
  ): Observable<ShoppingListCard> {
    return this.http.put<ShoppingListCard>(`${this.baseUrl}/${shoppingListId}/cards/${cardId}`, {
      quantity_owned: quantityOwned,
    });
  }

  removeCard(shoppingListId: number, cardId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${shoppingListId}/cards/${cardId}`);
  }
}
