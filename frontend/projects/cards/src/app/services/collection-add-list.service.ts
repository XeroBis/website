import { Injectable, signal } from '@angular/core';

import { CardCatalogEntry, VariantType } from '../models/card.model';

export interface CollectionAddEntry {
  /** `${catalogId}:${variantType}:${allVariants}` -- entries are keyed by
   * (card, variant-or-all-variants), not catalogId alone, since the same
   * card can be queued more than once with different variants. See
   * features.md's "Add to collection". */
  key: string;
  catalogId: number;
  name: string;
  setName: string;
  imagePath: string;
  quantity: number;
  /** Which print variant this entry adds -- ignored (disabled in the UI)
   * when allVariants is true. */
  variantType: VariantType;
  /** Fans out into one card_variant_quantities row per variant the card's
   * card_catalog_variants lists, each at `quantity` -- see CardCreate's
   * all_variants field. */
  allVariants: boolean;
}

const STORAGE_KEY = 'pokemon-cards:collection-add-list';

function entryKey(catalogId: number, variantType: VariantType, allVariants: boolean): string {
  return `${catalogId}:${variantType}:${allVariants}`;
}

@Injectable({ providedIn: 'root' })
export class CollectionAddListService {
  readonly entries = signal<CollectionAddEntry[]>(this.loadFromStorage());

  get value(): CollectionAddEntry[] {
    return this.entries();
  }

  addCard(entry: CardCatalogEntry): void {
    const key = entryKey(entry.id, 'standard', false);
    const existing = this.entries().find((e) => e.key === key);
    if (existing) {
      this.updateQuantity(existing.key, existing.quantity + 1);
      return;
    }
    this.set([
      ...this.entries(),
      {
        key,
        catalogId: entry.id,
        name: entry.name,
        setName: entry.set_name,
        imagePath: entry.image_path,
        quantity: 1,
        variantType: 'standard',
        allVariants: false,
      },
    ]);
  }

  updateQuantity(key: string, quantity: number): void {
    this.set(
      this.entries().map((e) => (e.key === key ? { ...e, quantity: Math.max(1, quantity) } : e)),
    );
  }

  /** Changing an entry's variant/allVariants re-keys it -- if another entry
   * for the same card already has the new key, they merge (quantities add)
   * rather than leaving two entries with the same key. */
  setVariant(key: string, variantType: VariantType, allVariants: boolean): void {
    const entry = this.entries().find((e) => e.key === key);
    if (!entry) {
      return;
    }
    const newKey = entryKey(entry.catalogId, variantType, allVariants);
    if (newKey === key) {
      this.set(this.entries().map((e) => (e.key === key ? { ...e, variantType, allVariants } : e)));
      return;
    }
    const target = this.entries().find((e) => e.key === newKey);
    if (target) {
      this.set(
        this.entries()
          .filter((e) => e.key !== key)
          .map((e) => (e.key === newKey ? { ...e, quantity: e.quantity + entry.quantity } : e)),
      );
      return;
    }
    this.set(
      this.entries().map((e) =>
        e.key === key ? { ...e, key: newKey, variantType, allVariants } : e,
      ),
    );
  }

  remove(key: string): void {
    this.set(this.entries().filter((e) => e.key !== key));
  }

  clear(): void {
    this.set([]);
  }

  private set(entries: CollectionAddEntry[]): void {
    this.entries.set(entries);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  private loadFromStorage(): CollectionAddEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: CollectionAddEntry[] = raw ? JSON.parse(raw) : [];
      // Entries persisted before the `key` field existed (or the old
      // isReverse boolean shape) would otherwise crash the panel -- drop
      // anything that doesn't match the current shape rather than migrating,
      // matching how transient staging state is treated elsewhere (Clear
      // list is one click away).
      return parsed.filter((e) => typeof e?.key === 'string' && typeof e?.variantType === 'string');
    } catch {
      return [];
    }
  }
}
