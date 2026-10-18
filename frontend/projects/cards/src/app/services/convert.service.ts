import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { DecklistConvertResponse } from '../models/card.model';

@Injectable({ providedIn: 'root' })
export class ConvertService {
  private readonly baseUrl = `/api/cards/convert`;

  constructor(private readonly http: HttpClient) {}

  convertDecklist(text: string, includeSets = true): Observable<DecklistConvertResponse> {
    return this.http.post<DecklistConvertResponse>(`${this.baseUrl}/decklist`, {
      text,
      include_sets: includeSets,
    });
  }
}
