import { TestBed } from '@angular/core/testing';

import { Card } from '../models/card.model';
import { DeckListService } from './deck-list.service';

const STORAGE_KEY = 'pokemon-cards:deck-list';

function card(overrides: Partial<Card>): Card {
  return {
    allocated_variants: {},
    id: 1,
    catalog_id: 1,
    variants: [{ variant_type: 'standard', quantity: 1, image_path_fr: null, image_path_us: null }],
    quantity: 1,
    created_at: '',
    name: 'Pikachu',
    set_name: 'Base',
    set_code: 'base1',
    card_number: '58',
    image_path: '/x.png',
    supertype: 'Pokémon',
    rarity: null,
    series: null,
    card_count: null,
    release_date: null,
    allocated: 0,
    available: 1,
    decks: [],
    ...overrides,
  };
}

describe('DeckListService', () => {
  let service: DeckListService;

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    TestBed.configureTestingModule({});
    service = TestBed.inject(DeckListService);
  });

  afterEach(() => localStorage.removeItem(STORAGE_KEY));

  it('starts empty when nothing is stored', () => {
    expect(service.value).toEqual([]);
  });

  it('adds a new card capped at the available quantity', () => {
    service.addCard(
      card({
        id: 1,
        variants: [
          { variant_type: 'standard', quantity: 3, image_path_fr: null, image_path_us: null },
        ],
        available: 3,
      }),
    );
    expect(service.value).toEqual([
      expect.objectContaining({ cardId: 1, quantity: 1, available: 3, variantType: 'standard' }),
    ]);
  });

  it('does not add a card when none are available', () => {
    service.addCard(
      card({
        id: 1,
        variants: [
          { variant_type: 'standard', quantity: 0, image_path_fr: null, image_path_us: null },
        ],
        available: 0,
      }),
    );
    expect(service.value).toEqual([]);
  });

  it('falls back to an available reverse print when standard is unowned', () => {
    service.addCard(
      card({
        variants: [
          { variant_type: 'reverse', quantity: 2, image_path_fr: null, image_path_us: null },
        ],
        quantity: 2,
        available: 2,
      }),
    );

    expect(service.value).toEqual([
      expect.objectContaining({ quantity: 1, available: 2, variantType: 'reverse' }),
    ]);
  });

  it('increments quantity (capped at available) when adding an already-present card', () => {
    const c = card({
      id: 1,
      variants: [
        { variant_type: 'standard', quantity: 3, image_path_fr: null, image_path_us: null },
      ],
      available: 3,
    });
    service.addCard(c);
    service.addCard(c);
    service.addCard(c);
    service.addCard(c);
    expect(service.value[0].quantity).toBe(3);
  });

  it('updateQuantity clamps between 1 and available', () => {
    const c = card({
      id: 1,
      variants: [
        { variant_type: 'standard', quantity: 5, image_path_fr: null, image_path_us: null },
      ],
      available: 5,
    });
    service.addCard(c);
    const key = service.value[0].key;
    service.updateQuantity(key, 0);
    expect(service.value[0].quantity).toBe(1);
    service.updateQuantity(key, 100);
    expect(service.value[0].quantity).toBe(5);
    service.updateQuantity(key, 3);
    expect(service.value[0].quantity).toBe(3);
  });

  it('removes a card by key', () => {
    service.addCard(card({ id: 1 }));
    service.addCard(card({ id: 2, name: 'Charizard' }));
    const firstKey = service.value.find((e) => e.cardId === 1)!.key;
    service.remove(firstKey);
    expect(service.value.map((e) => e.cardId)).toEqual([2]);
  });

  it('clears all entries', () => {
    service.addCard(card({ id: 1 }));
    service.clear();
    expect(service.value).toEqual([]);
  });

  it('persists entries to localStorage', () => {
    service.addCard(card({ id: 1 }));
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toEqual([expect.objectContaining({ cardId: 1 })]);
  });

  it('loads existing entries from localStorage on construction', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          key: '9:standard:false',
          cardId: 9,
          catalogId: 9,
          name: 'Squirtle',
          setName: 'Base',
          imagePath: '/s.png',
          quantity: 2,
          available: 4,
          variantType: 'standard',
          allVariants: false,
        },
      ]),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(DeckListService);
    expect(fresh.value).toEqual([expect.objectContaining({ cardId: 9, quantity: 2 })]);
  });
});
