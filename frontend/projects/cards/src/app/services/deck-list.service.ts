import { Injectable, signal } from '@angular/core';

import { Card, VariantType } from '../models/card.model';

export interface DeckListEntry {
  /** `${cardId}:${variantType}:${allVariants}` -- entries are keyed by
   * (card, variant-or-all-variants), not cardId alone, mirroring
   * CollectionAddListService's key shape, since the same card can be queued
   * more than once with different variants. See features.md's "Add to
   * deck". */
  key: string;
  cardId: number;
  catalogId: number;
  name: string;
  setName: string;
  imagePath: string;
  quantity: number;
  /** Client-side stepper bound only, not authoritative -- the backend
   * re-validates real availability per variant on submit (see
   * DecksService.bulkAddCards). Estimated as this variant's own owned
   * quantity capped by the card's overall available figure. */
  available: number;
  /** Which print variant this entry adds -- ignored (disabled in the UI)
   * when allVariants is true. */
  variantType: VariantType;
  /** Fans out into one deck_cards row per variant the card's
   * card_catalog_variants lists, each at `quantity` -- see
   * DeckBulkAddItem's all_variants field. */
  allVariants: boolean;
}

const STORAGE_KEY = 'pokemon-cards:deck-list';

function entryKey(cardId: number, variantType: VariantType, allVariants: boolean): string {
  return `${cardId}:${variantType}:${allVariants}`;
}

@Injectable({ providedIn: 'root' })
export class DeckListService {
  readonly entries = signal<DeckListEntry[]>(this.loadFromStorage());

  get value(): DeckListEntry[] {
    return this.entries();
  }

  /** Queues the requested print when it is available. If a standard-mode
   * Collection tile represents a reverse-only card, fall back to an owned
   * print instead of silently rejecting the click. */
  addCard(card: Card, preferredVariantType: VariantType = 'standard'): void {
    const preferred = card.variants.find((v) => v.variant_type === preferredVariantType);
    const variant =
      preferred && Math.min(preferred.quantity, card.available) > 0
        ? preferred
        : card.variants.find((v) => Math.min(v.quantity, card.available) > 0);
    if (!variant) {
      return;
    }
    const variantType = variant.variant_type;
    const key = entryKey(card.id, variantType, false);
    const available = Math.min(variant.quantity, card.available);
    const existing = this.entries().find((e) => e.key === key);
    if (existing) {
      this.updateQuantity(key, Math.min(existing.quantity + 1, existing.available));
      return;
    }
    this.set([
      ...this.entries(),
      {
        key,
        cardId: card.id,
        catalogId: card.catalog_id,
        name: card.name,
        setName: card.set_name,
        imagePath: card.image_path,
        quantity: Math.min(1, available),
        available,
        variantType,
        allVariants: false,
      },
    ]);
  }

  updateQuantity(key: string, quantity: number): void {
    this.set(
      this.entries().map((e) =>
        e.key === key ? { ...e, quantity: Math.max(1, Math.min(quantity, e.available)) } : e,
      ),
    );
  }

  /** Changing an entry's variant/allVariants re-keys it -- if another entry
   * for the same card already has the new key, they merge (quantities add)
   * rather than leaving two entries with the same key. */
  setVariant(key: string, card: Card, variantType: VariantType, allVariants: boolean): void {
    const entry = this.entries().find((e) => e.key === key);
    if (!entry) {
      return;
    }
    const newKey = entryKey(entry.cardId, variantType, allVariants);
    const variant = card.variants.find((v) => v.variant_type === variantType);
    const available = Math.min(variant?.quantity ?? 0, card.available);
    if (newKey === key) {
      this.set(
        this.entries().map((e) =>
          e.key === key ? { ...e, variantType, allVariants, available } : e,
        ),
      );
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
        e.key === key ? { ...e, key: newKey, variantType, allVariants, available } : e,
      ),
    );
  }

  remove(key: string): void {
    this.set(this.entries().filter((e) => e.key !== key));
  }

  clear(): void {
    this.set([]);
  }

  private set(entries: DeckListEntry[]): void {
    this.entries.set(entries);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  private loadFromStorage(): DeckListEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: DeckListEntry[] = raw ? JSON.parse(raw) : [];
      // Entries persisted before the `key` field existed would otherwise
      // crash the panel -- drop anything that doesn't match the current
      // shape rather than migrating, matching CollectionAddListService.
      return parsed.filter((e) => typeof e?.key === 'string' && typeof e?.variantType === 'string');
    } catch {
      return [];
    }
  }
}
