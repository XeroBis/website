import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  CardCatalogDeckUsage,
  CardCatalogEntry,
  CardCatalogPage,
  CardCatalogVariant,
  CardSet,
  CatalogStats,
  MissingSetIntervals,
  RefreshStepStatus,
  VariantType,
} from '../models/card.model';

/** Shared filters for image archive import and export. */
export interface ImageArchiveSelection {
  french: boolean;
  english: boolean;
  standard: boolean;
  variants: boolean;
  logos: boolean;
  symbols: boolean;
  setCodes: string[];
}

function imageArchiveParams(selection: ImageArchiveSelection): HttpParams {
  let params = new HttpParams({
    fromObject: Object.fromEntries(
      Object.entries(selection).map(([key, value]) => [key, String(value)]),
    ),
  });
  // The API accepts the same repeated set_code convention as its catalog
  // filters. Do not serialize the array as a comma-separated value.
  params = params.delete('setCodes');
  for (const setCode of selection.setCodes) {
    params = params.append('set_code', setCode);
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class CatalogService {
  importCatalog(data: unknown): Observable<{ created: number; updated: number }> {
    return this.http.post<{ created: number; updated: number }>(
      `${this.baseUrl}/import/metadata`,
      data,
    );
  }

  private readonly baseUrl = `/api/cards/catalog`;

  constructor(private readonly http: HttpClient) {}

  browse(
    options: {
      search?: string;
      setCode?: string;
      setName?: string;
      supertype?: string[];
      rarity?: string[];
      cardNumber?: string;
      /** Catalog-existence filter: which of card_catalog_variants' non-
       * standard variant_types the card must have at least one of. See
       * features.md's "Filter by print variant". */
      variantType?: string[];
      sort?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ): Observable<CardCatalogPage> {
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
    if (options.cardNumber) {
      params = params.set('card_number', options.cardNumber);
    }
    for (const value of options.variantType ?? []) {
      params = params.append('variant_type', value);
    }
    return this.http.get<CardCatalogPage>(this.baseUrl, { params });
  }

  getById(catalogId: number): Observable<CardCatalogEntry> {
    return this.http.get<CardCatalogEntry>(`${this.baseUrl}/${catalogId}`);
  }

  /** Which print variants this catalog card comes in (standard/reverse
   * always included, plus any scraped ball-pattern variants) -- drives the
   * add-to-collection variant dropdown, the card-detail "add a variant"
   * action, and the Set detail page's "Show variants" toggle. */
  getCardVariants(catalogId: number): Observable<CardCatalogVariant[]> {
    return this.http.get<CardCatalogVariant[]>(`${this.baseUrl}/${catalogId}/variants`);
  }

  /** Which of the current user's decks (real allocation + phantom
   * want-lists) reference this catalog card -- powers the shared card
   * detail modal's "used in decks" section from any page. */
  getDeckUsage(catalogId: number): Observable<CardCatalogDeckUsage> {
    return this.http.get<CardCatalogDeckUsage>(`${this.baseUrl}/${catalogId}/deck-usage`);
  }

  /** Exact rarity and print eligibility, matching missing-card export. */
  listSets(
    rarities: string[] = [],
    variant: VariantType | VariantType[] | 'all' | null = null,
  ): Observable<CardSet[]> {
    let params = new HttpParams();
    for (const rarity of rarities) {
      params = params.append('rarity', rarity);
    }
    if (Array.isArray(variant)) {
      if (variant.length === 0) params = params.set('reverse', true);
      for (const value of variant) params = params.append('variant_type', value);
    } else if (variant === 'all') {
      params = params.set('reverse', true);
    } else if (variant) {
      params = params.set('variant_type', variant);
    }
    return this.http.get<CardSet[]>(`${this.baseUrl}/sets`, { params });
  }

  /** Missing numeric IDs for any owned print, or one specific reverse type.
   * `includeIncoming`: cards on incoming purchase lists count as owned. */
  listMissingIntervals(
    rarities: string[] = [],
    variant: VariantType | null = null,
    includeIncoming = true,
  ): Observable<MissingSetIntervals[]> {
    let params = new HttpParams().set('include_incoming', String(includeIncoming));
    for (const rarity of rarities) {
      params = params.append('rarity', rarity);
    }
    if (variant) {
      params = params.set('variant_type', variant);
    }
    return this.http.get<MissingSetIntervals[]>(`${this.baseUrl}/missing-intervals`, { params });
  }

  /** Every card in one set, for the Sets page's set detail view. */
  getSetCards(setCode: string): Observable<CardCatalogEntry[]> {
    return this.http.get<CardCatalogEntry[]>(`${this.baseUrl}/sets/${setCode}/cards`);
  }

  /** Cardmarket-format decklist of every card in this set not owned at all
   * -- see the Sets page's "Export missing cards". includeExtraNumbering
   * includes secret/ultra rares
   * numbered past the set's card_count and non-numeric card numbers,
   * excluded by default. */
  exportSetMissingText(
    setCode: string,
    rarities: string[],
    format: 'tcgplayer' | 'cardmarket',
    language: 'en' | 'fr',
    excludeDeckAllocated: boolean,
    includeIncoming: boolean,
    variantType: VariantType | '' = '',
  ): Observable<string> {
    let params = new HttpParams()
      .set('format', format)
      .set('language', language)
      .set('exclude_deck_allocated', String(excludeDeckAllocated))
      .set('include_incoming', String(includeIncoming));
    if (variantType) params = params.set('variant_type', variantType);
    for (const rarity of rarities) {
      params = params.append('rarity', rarity);
    }
    return this.http.get(`${this.baseUrl}/sets/${setCode}/missing/text`, {
      params,
      responseType: 'text',
    });
  }

  /** Combined "export missing cards" across several sets at once (the Sets
   * page's "Combine sets export") -- same params as exportSetMissingText
   * above, but `setCodes` goes in the POST body and the single rarity/
   * format/language/exclude-deck-allocated selection applies across every
   * selected set. See documentation/features.md's "Combined sets
   * missing-cards export". */
  exportMultiSetMissingText(
    setCodes: string[],
    rarities: string[],
    format: 'tcgplayer' | 'cardmarket',
    language: 'en' | 'fr',
    excludeDeckAllocated: boolean,
    includeIncoming: boolean,
  ): Observable<string> {
    let params = new HttpParams()
      .set('format', format)
      .set('language', language)
      .set('exclude_deck_allocated', String(excludeDeckAllocated))
      .set('include_incoming', String(includeIncoming));
    for (const rarity of rarities) {
      params = params.append('rarity', rarity);
    }
    return this.http.post(
      `${this.baseUrl}/sets/missing/text`,
      { set_codes: setCodes },
      { params, responseType: 'text' },
    );
  }

  listRarities(): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/rarities`);
  }

  /** Non-standard variant_types present anywhere in the catalog -- drives
   * Browse's "Filter by print variant" (existence-based). */
  listVariantTypes(): Observable<VariantType[]> {
    return this.http.get<VariantType[]>(`${this.baseUrl}/variant-types`);
  }

  /** Kicks off the background "run all steps" refresh job; poll
   * refreshStatus() for progress. Each step is also runnable on its own via
   * startRefreshStep()/refreshStepStatus() below. */
  startRefresh(): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.baseUrl}/refresh`, {});
  }

  refreshStatus(): Observable<RefreshStepStatus> {
    return this.http.get<RefreshStepStatus>(`${this.baseUrl}/refresh/status`);
  }

  /** Kicks off one refresh step on its own (see backend's REFRESH_STEPS);
   * poll refreshStepStatus(key) for progress. Only one refresh-related job
   * -- a single step or the "run all" combo -- can run at a time. */
  startRefreshStep(key: string): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.baseUrl}/refresh/steps/${key}`, {});
  }

  refreshStepStatus(key: string): Observable<RefreshStepStatus> {
    return this.http.get<RefreshStepStatus>(`${this.baseUrl}/refresh/steps/${key}/status`);
  }

  /** Per-category counts for the Catalog Management page. */
  getStats(): Observable<CatalogStats> {
    return this.http.get<CatalogStats>(`${this.baseUrl}/stats`);
  }

  /**
   * Imports the whole backend/data/ tree from a zip archive, straight onto
   * disk and reconnects pending catalog image paths; answers 202 after upload, then imageImportStatus reports restore/link progress.
   * Reports real upload progress via HttpEvent (rather than a static
   * "Uploading..." indicator) since the archive can be multi-GB.
   */
  importImages(
    file: File,
    selection: ImageArchiveSelection,
  ): Observable<HttpEvent<{ status: string }>> {
    return this.http.post<{ status: string }>(`${this.baseUrl}/import/images`, file, {
      params: imageArchiveParams(selection),
      headers: { 'Content-Type': 'application/zip' },
      reportProgress: true,
      observe: 'events',
    });
  }

  imageImportStatus(): Observable<RefreshStepStatus> {
    return this.http.get<RefreshStepStatus>(`${this.baseUrl}/import/images/status`);
  }

  /** Corrects a card_catalog row's name (e.g. a scraper typo) from the
   * Browse detail view's edit mode -- the only catalog field editable
   * from the UI, since the rest is scraper-owned reference data. */
  updateName(id: number, name: string): Observable<CardCatalogEntry> {
    return this.http.patch<CardCatalogEntry>(`${this.baseUrl}/${id}`, { name });
  }

  exportCatalog(): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/export`, { responseType: 'blob' });
  }

  exportImagesUrl(selection: ImageArchiveSelection): string {
    return `${this.baseUrl}/export/images?${imageArchiveParams(selection).toString()}`;
  }

  /** Every catalog/collection/set/variant image path is already relative to
   * backend/data/ -- served as one static tree, /api/cards/images/ (see main.py). */
  imageUrl(imagePath: string): string {
    return `/api/cards/images/${imagePath}`;
  }

  /** Small JPEG variant (~300px wide) for grid tiles/table rows — see
   * documentation/decisions.md's "Card Thumbnails". A thumbnail sits in a
   * sibling `thumbnails/` folder next to its card's own `cards/` folder,
   * same filename -- there's no separate thumbnails mount to swap to, so
   * this just string-replaces the folder segment. Use imageUrl() instead
   * for full-res contexts like the card detail modal. */
  thumbnailUrl(imagePath: string): string {
    return this.imageUrl(imagePath.replace('/cards/', '/thumbnails/'));
  }

  /** Ball-pattern/reverse variant scans (card_catalog_variants.image_path_fr/us)
   * -- stored under the same data/<series>/<set_code>/cards/ tree as
   * card_catalog.image_path, so this is just imageUrl(). */
  variantImageUrl(imagePath: string): string {
    return this.imageUrl(imagePath);
  }
}
