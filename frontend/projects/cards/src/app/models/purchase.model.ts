export interface Purchase {
  id: number;
  product_name: string;
  price: number;
  quantity: number;
  purchased_at: string;
  source: string | null;
  description: string | null;
  sets: string[];
  created_at: string;
}

export interface PurchaseCreate {
  product_name: string;
  price: number;
  quantity: number;
  purchased_at: string;
  source: string | null;
  description: string | null;
  sets: string[];
}

export type PurchaseUpdate = PurchaseCreate;

export interface PurchaseWipeResult {
  deleted_purchases: number;
}

export type PurchaseSortOption =
  | 'date_desc'
  | 'date_asc'
  | 'name_asc'
  | 'name_desc'
  | 'price_desc'
  | 'price_asc'
  | 'source_asc'
  | 'source_desc';
