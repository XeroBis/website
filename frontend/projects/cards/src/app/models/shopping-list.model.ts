export interface ShoppingListCard {
  id: number;
  catalog_id: number;
  name: string;
  name_en: string;
  name_fr: string;
  set_code: string;
  card_number: string;
  supertype: string | null;
  set_name: string;
  image_path: string;
  quantity_needed: number;
  quantity_owned: number;
}

export interface ShoppingList {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  total_cards: number;
  total_quantity_needed: number;
  fully_got_cards: number;
}

export interface ShoppingListDetail extends ShoppingList {
  cards: ShoppingListCard[];
}

export interface ShoppingListPasteResult {
  shopping_list: ShoppingListDetail;
  lines_added: number;
  lines_skipped: number;
}
