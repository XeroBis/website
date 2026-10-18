import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { Share, ShareCreate, SharedSet } from '../models/card.model';

/** Authenticated create/list/revoke calls for the owner's own share links
 * (see documentation/features.md's "Share a set"/"Manage share links").
 * The public read (`GET /api/cards/public/shares/{token}`) is deliberately kept
 * out of this service -- see PublicSharesService below, so the shared-set
 * page never accidentally pulls in an authenticated call path. */
@Injectable({ providedIn: 'root' })
export class SharesService {
  private readonly baseUrl = `/api/cards/shares`;

  constructor(private readonly http: HttpClient) {}

  create(payload: ShareCreate): Observable<Share> {
    return this.http.post<Share>(this.baseUrl, payload);
  }

  list(): Observable<Share[]> {
    return this.http.get<Share[]>(this.baseUrl);
  }

  revoke(id: number): Observable<Share> {
    return this.http.delete<Share>(`${this.baseUrl}/${id}`);
  }

  shareUrl(token: string): string {
    return `${window.location.origin}/shared/${token}`;
  }
}

/** The one unauthenticated call in the whole app -- see
 * documentation/architecture.md's "One deliberate public exception". Kept
 * as its own service (rather than a method on SharesService) so it's
 * obvious at a glance that /shared/:token never depends on anything
 * requiring a login session.
 *
 * Image URLs are also built against this token-scoped API (not
 * CatalogService's imageUrl()/thumbnailUrl(), which point at the
 * still-gated /api/cards/images/ mount) -- see documentation/decisions.md's
 * "Set Sharing" for why: a share link only ever exposes the
 * scans/thumbnails/logo/symbol for its own set, and access dies the moment
 * the share is revoked/expires, rather than opening that mount up for the
 * whole catalog. */
@Injectable({ providedIn: 'root' })
export class PublicSharesService {
  private readonly baseUrl = `/api/cards/public/shares`;

  constructor(private readonly http: HttpClient) {}

  get(token: string): Observable<SharedSet> {
    return this.http.get<SharedSet>(`${this.baseUrl}/${token}`);
  }

  /** A card's thumbnail sits in a sibling `thumbnails/` folder next to its
   * `cards/` folder, same filename -- the same derivation
   * CatalogService.thumbnailUrl() does for the authenticated side. */
  thumbnailUrl(token: string, imagePath: string): string {
    return this.imageUrl(token, imagePath.replace('/cards/', '/thumbnails/'));
  }

  /** Ball-pattern/reverse variant scans live in the same
   * <series>/<set_code>/cards/ tree as card_catalog.image_path. */
  variantImageUrl(token: string, imagePath: string): string {
    return this.imageUrl(token, imagePath);
  }

  private imageUrl(token: string, relativePath: string): string {
    return `${this.baseUrl}/${token}/images/${relativePath}`;
  }

  logoUrl(token: string): string {
    return `${this.baseUrl}/${token}/logo`;
  }

  symbolUrl(token: string): string {
    return `${this.baseUrl}/${token}/symbol`;
  }
}
