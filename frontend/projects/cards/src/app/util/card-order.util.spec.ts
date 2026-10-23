import { cardOrderFor, orderCards, readStoredCardOrder, storeCardOrder } from './card-order.util';

interface TestCard {
  name: string;
  quantity: number;
}

describe('orderCards', () => {
  // In number order.
  const cards: TestCard[] = [
    { name: 'Pikachu', quantity: 1 },
    { name: 'Bulbasaur', quantity: 3 },
    { name: 'Charizard', quantity: 1 },
  ];
  const keys = { name: (c: TestCard) => c.name, quantity: (c: TestCard) => c.quantity };
  const names = (order: Parameters<typeof orderCards>[1]) =>
    orderCards(cards, order, keys).map((c) => c.name);

  it('keeps the given order by number, reversed when descending', () => {
    expect(names({ field: 'number', descending: false })).toEqual([
      'Pikachu',
      'Bulbasaur',
      'Charizard',
    ]);
    expect(names({ field: 'number', descending: true })).toEqual([
      'Charizard',
      'Bulbasaur',
      'Pikachu',
    ]);
  });

  it('sorts by name', () => {
    expect(names({ field: 'name', descending: false })).toEqual([
      'Bulbasaur',
      'Charizard',
      'Pikachu',
    ]);
  });

  it('sorts by quantity, ties in number order', () => {
    expect(names({ field: 'quantity', descending: true })).toEqual([
      'Bulbasaur',
      'Pikachu',
      'Charizard',
    ]);
    expect(names({ field: 'quantity', descending: false })).toEqual([
      'Pikachu',
      'Charizard',
      'Bulbasaur',
    ]);
  });

  it('does not mutate the input array', () => {
    const original = [...cards];
    orderCards(cards, { field: 'name', descending: true }, keys);
    expect(cards).toEqual(original);
  });
});

describe('card order storage', () => {
  beforeEach(() => localStorage.removeItem('testOrder'));

  it('starts quantity most first, the others ascending', () => {
    expect(cardOrderFor('quantity').descending).toBe(true);
    expect(cardOrderFor('name').descending).toBe(false);
  });

  it('round-trips and falls back to number on bad data', () => {
    storeCardOrder('testOrder', { field: 'name', descending: true });
    expect(readStoredCardOrder('testOrder')).toEqual({ field: 'name', descending: true });
    localStorage.setItem('testOrder', '{"field":"price"}');
    expect(readStoredCardOrder('testOrder')).toEqual({ field: 'number', descending: false });
  });
});
