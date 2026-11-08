import { VariantType } from './card.model';
import { PurchaseListCard } from './purchase-list.model';

/** A sale list's line: the same fields as a purchase list's. */
export type SaleListCard = PurchaseListCard;

export interface SaleList {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  sold_at: string | null;
  total_cards: number;
  total_quantity: number;
}

export interface SaleListDetail extends SaleList {
  cards: SaleListCard[];
}

export interface OnSalePrint {
  catalog_id: number;
  variant_type: VariantType;
  quantity: number;
}
