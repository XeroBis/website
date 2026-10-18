import { VariantType } from './card.model';

export type DeckType = 'normal' | 'phantom';

/** Only meaningfully filters a phantom deck's export -- see DecksService.exportDeck. */
export type DeckExportMode = 'full' | 'missing' | 'not_available';

/** 'json' downloads a file; 'tcgplayer'/'cardmarket' copy a marketplace-formatted
 * decklist to the clipboard instead -- see DeckActionsComponent.doExport. */
export type DeckExportFormat = 'json' | DeckExportTextFormat;

/** The two copy-to-clipboard formats -- same format/matching logic as the
 * Decklist Converter, rendered server-side by GET /decks/{id}/export/text. */
export type DeckExportTextFormat = 'tcgplayer' | 'cardmarket';

/** Filters a draft's "Export missing" text export down to positive-delta
 * entries not yet fully owned ('missing') or not yet fully available
 * ('not_available'/'reserve_singles') -- see DeckUpgradeDraftsService.exportDraftText.
 * 'reserve_singles' is like 'not_available' but additionally treats a card
 * with exactly 1 available copy as having 0 available, since that lone
 * copy is assumed kept in the binder to complete the set. */
export type DraftExportMode = 'missing' | 'not_available' | 'reserve_singles' | 'full';

export interface DeckExportCardItem {
  name: string;
  set_code: string;
  card_number: string;
  variant_type: VariantType;
  quantity_in_deck: number;
}

/** One line of a Deck Upgrade Draft's proposed changes, as a signed delta against
 * the deck's own quantity for that card -- mirrors deck_upgrade_draft_cards. */
export interface DeckExportDraftEntry {
  name: string;
  set_code: string;
  card_number: string;
  variant_type: VariantType;
  quantity_delta: number;
}

export interface DeckExportDraft {
  name: string;
  entries: DeckExportDraftEntry[];
}

export interface DeckExport {
  name: string;
  description: string | null;
  deck_type: DeckType;
  cards: DeckExportCardItem[];
  /** Only present (and only possible) for a Normal deck with saved drafts -- absent
   * otherwise, see documentation/data-model.md's "deck_upgrade_drafts". */
  drafts?: DeckExportDraft[];
}

export interface Deck {
  id: number;
  name: string;
  description: string | null;
  deck_type: DeckType;
  /** True if any of the deck's cards belong to a World Championship Deck
   * catalog set -- a display-only tag, recomputed by the backend whenever
   * the deck's cards change. See documentation/data-model.md's
   * `decks.has_wdc_cards`. */
  has_wdc_cards: boolean;
  created_at: string;
  total_cards: number;
  /** Up to 3 of this deck's own cards, user-picked to represent it in the
   * deck list row and deck detail header, in display order -- empty until
   * picked (shows blank placeholder slots instead of falling back to an
   * auto-computed selection). See documentation/features.md's "Poster
   * cards". */
  poster_cards: DeckCard[];
}

export interface DeckCardAllocation {
  deck_id: number;
  deck_name: string;
  quantity_in_deck: number;
}

export interface DeckCard {
  id: number;
  card_id: number | null;
  catalog_id: number | null;
  variant_type: VariantType;
  quantity_in_deck: number;
  name: string;
  set_name: string;
  image_path: string;
  available: number | null;
  owned: number | null;
  allocated_decks: DeckCardAllocation[];
  supertype: string | null;
}

export interface DeckDetail extends Deck {
  cards: DeckCard[];
}

export interface DeckCreate {
  name: string;
  description?: string | null;
  deck_type?: DeckType;
  decklist_text?: string | null;
}

export interface DeckUpdate {
  name?: string;
  description?: string | null;
  /** Up to 3 deck_cards.id values already in this deck, in display order --
   * replaces the current poster selection; `[]` clears it. */
  poster_card_ids?: number[];
}

export interface DeckCardCreate {
  card_id?: number;
  catalog_id?: number;
  variant_type?: VariantType;
  quantity_in_deck: number;
}

export interface DeckFromPasteRequest {
  decklist_text: string;
}

export interface DeckCardUpdate {
  quantity_in_deck: number;
}

export interface DeckBulkAddItem {
  card_id: number;
  variant_type?: VariantType;
  all_variants?: boolean;
  quantity_in_deck: number;
}

export interface DeckBulkAddRequest {
  items: DeckBulkAddItem[];
}

export interface DeckCopyRequest {
  name: string;
}

export type DeckHistoryAction =
  | 'created'
  | 'renamed'
  | 'description_changed'
  | 'copied'
  | 'card_added'
  | 'card_quantity_changed'
  | 'card_removed';

export interface DeckHistoryEntry {
  id: number;
  deck_id: number;
  action: DeckHistoryAction;
  detail: string | null;
  old_value: string | null;
  new_value: string | null;
  variant_type: VariantType | null;
  created_at: string;
}

export interface DeckHistoryPage {
  total: number;
  page: number;
  page_size: number;
  items: DeckHistoryEntry[];
}

export interface DeckWipeResult {
  deleted_decks: number;
}

export interface DeckCombatOption {
  id: number;
  name: string;
  deck_type: DeckType;
  has_wdc_cards: boolean;
  owner_id: number;
  owner_label: string;
}

/** A named, persisted "what if" diff against a Normal deck's current cards
 * -- see documentation/features.md's "Deck Upgrade Drafts". Not available
 * for Phantom decks. */
export interface DeckUpgradeDraft {
  id: number;
  deck_id: number;
  name: string;
  created_at: string;
  updated_at: string;
  entry_count: number;
}

export interface DeckUpgradeDraftEntry {
  catalog_id: number;
  variant_type: VariantType;
  name: string;
  set_name: string;
  image_path: string;
  supertype: string | null;
  baseline_quantity: number;
  quantity_delta: number;
  result_quantity: number;
  owned: number;
  /** Already has one copy reserved for the binder (classeur) subtracted out
   * -- see documentation/features.md's "Deck upgrade drafts". */
  available: number;
}

export interface DeckUpgradeDraftResultCard {
  catalog_id: number;
  variant_type: VariantType;
  name: string;
  set_name: string;
  image_path: string;
  supertype: string | null;
  quantity_in_deck: number;
}

export interface DeckUpgradeDraftDetail {
  id: number;
  deck_id: number;
  name: string;
  created_at: string;
  updated_at: string;
  current_cards: DeckCard[];
  entries: DeckUpgradeDraftEntry[];
  result_cards: DeckUpgradeDraftResultCard[];
  result_total: number;
  can_apply: boolean;
}

export interface DeckUpgradeDraftCreate {
  name: string;
  decklist_text?: string | null;
}

export interface DeckUpgradeDraftUpdate {
  name: string;
}

export interface DeckUpgradeDraftPasteRequest {
  decklist_text: string;
}

export interface DeckUpgradeDraftEntryUpdate {
  quantity_delta: number;
}

/** One row in the cross-deck "combine drafts" export picker (deck list
 * page) -- see documentation/features.md's "Combined draft export". */
export interface DraftPickerItem {
  id: number;
  deck_id: number;
  deck_name: string;
  name: string;
  updated_at: string;
  result_total: number;
}

export interface MultiDraftExportRequest {
  draft_ids: number[];
}
