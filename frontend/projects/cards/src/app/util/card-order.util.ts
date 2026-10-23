/** Client-side order of an already loaded card list (set page, purchase
 * list): 'number' is the order the list came in. */
export type CardOrderField = 'number' | 'name' | 'quantity';

export interface CardOrder {
  field: CardOrderField;
  descending: boolean;
}

export const CARD_ORDER_FIELDS: CardOrderField[] = ['number', 'name', 'quantity'];

export const DEFAULT_CARD_ORDER: CardOrder = { field: 'number', descending: false };

/** Picking a field starts in its natural direction: most copies first. */
export function cardOrderFor(field: CardOrderField): CardOrder {
  return { field, descending: field === 'quantity' };
}

export function readStoredCardOrder(key: string): CardOrder {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null');
    return CARD_ORDER_FIELDS.includes(stored?.field)
      ? { field: stored.field, descending: !!stored.descending }
      : DEFAULT_CARD_ORDER;
  } catch {
    return DEFAULT_CARD_ORDER;
  }
}

export function storeCardOrder(key: string, order: CardOrder): void {
  try {
    localStorage.setItem(key, JSON.stringify(order));
  } catch {
    // Storage unavailable -- the choice just won't persist.
  }
}

/** `items` sorted by `order`, assuming they come in number order; ties keep
 * that order. */
export function orderCards<T>(
  items: T[],
  order: CardOrder,
  keys: { name: (item: T) => string; quantity: (item: T) => number },
): T[] {
  const sign = order.descending ? -1 : 1;
  const indexed = items.map((item, index) => ({ item, index }));
  indexed.sort((a, b) => {
    let primary = 0;
    if (order.field === 'name') {
      primary = keys.name(a.item).localeCompare(keys.name(b.item));
    } else if (order.field === 'quantity') {
      primary = keys.quantity(a.item) - keys.quantity(b.item);
    } else {
      primary = a.index - b.index;
    }
    return sign * primary || a.index - b.index;
  });
  return indexed.map(({ item }) => item);
}
