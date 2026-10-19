import { VariantType } from './card.model';

export interface PurchaseListCard {
  id: number;
  catalog_id: number;
  variant_type: VariantType;
  quantity: number;
  name: string;
  set_name: string;
  set_code: string;
  card_number: string;
  image_path: string;
  supertype: string | null;
  rarity: string | null;
  /** Prints the card comes in. */
  variants: VariantType[];
}

export interface PurchaseList {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  received_at: string | null;
  /** The total entered, if any. */
  price: string | null;
  total_cards: number;
  total_quantity: number;
}

export interface PurchaseListDetail extends PurchaseList {
  cards: PurchaseListCard[];
}

export interface CardmarketLine {
  quantity: number;
  unit_price: string;
  label: string;
  matched: boolean;
  reason: string | null;
  catalog_id: number | null;
  variant_type: VariantType | null;
  name: string | null;
  set_code: string | null;
  card_number: string | null;
  image_path: string | null;
}

export interface CardmarketPreview {
  total_quantity: number;
  total_price: string;
  set_codes: string[];
  lines: CardmarketLine[];
}

export interface UnmatchedArticle {
  quantity: number;
  label: string;
  reason: string;
}

export interface CardmarketImportResult {
  purchase_list: PurchaseListDetail;
  unmatched: UnmatchedArticle[];
}

export interface IncomingPrint {
  catalog_id: number;
  variant_type: VariantType;
  quantity: number;
}
