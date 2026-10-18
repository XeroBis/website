import { TestBed } from '@angular/core/testing';

import { CardCatalogEntry } from '../models/card.model';
import { CollectionAddListService } from './collection-add-list.service';

const STORAGE_KEY = 'pokemon-cards:collection-add-list';

function catalogEntry(overrides: Partial<CardCatalogEntry>): CardCatalogEntry {
  return {
    id: 1,
    name: 'Pikachu',
    variants: [],
    set_name: 'Base',
    set_name_fr: null,
    set_code: 'base1',
    card_number: '58',
    image_path: '/x.png',
    source_url: null,
    supertype: 'Pokémon',
    rarity: null,
    series: null,
    card_count: null,
    release_date: null,
    created_at: '',
    ...overrides,
  };
}

describe('CollectionAddListService', () => {
  let service: CollectionAddListService;

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    TestBed.configureTestingModule({});
    service = TestBed.inject(CollectionAddListService);
  });

  afterEach(() => localStorage.removeItem(STORAGE_KEY));

  it('starts empty when nothing is stored', () => {
    expect(service.value).toEqual([]);
  });

  it('adds a new card with quantity 1 and the standard variant', () => {
    service.addCard(catalogEntry({ id: 1 }));
    expect(service.value).toEqual([
      expect.objectContaining({
        catalogId: 1,
        quantity: 1,
        variantType: 'standard',
        allVariants: false,
      }),
    ]);
  });

  it('increments quantity when adding an already-present card', () => {
    service.addCard(catalogEntry({ id: 1 }));
    service.addCard(catalogEntry({ id: 1 }));
    expect(service.value[0].quantity).toBe(2);
  });

  it('updateQuantity never drops below 1', () => {
    service.addCard(catalogEntry({ id: 1 }));
    const key = service.value[0].key;
    service.updateQuantity(key, 0);
    expect(service.value[0].quantity).toBe(1);
    service.updateQuantity(key, -5);
    expect(service.value[0].quantity).toBe(1);
    service.updateQuantity(key, 7);
    expect(service.value[0].quantity).toBe(7);
  });

  it('setVariant changes the matching entry only', () => {
    service.addCard(catalogEntry({ id: 1 }));
    service.addCard(catalogEntry({ id: 2, name: 'Charizard' }));
    service.setVariant(service.value[0].key, 'reverse', false);
    expect(service.value.find((e) => e.catalogId === 1)?.variantType).toBe('reverse');
    expect(service.value.find((e) => e.catalogId === 2)?.variantType).toBe('standard');
  });

  it('removes a card by entry key', () => {
    service.addCard(catalogEntry({ id: 1 }));
    service.addCard(catalogEntry({ id: 2, name: 'Charizard' }));
    service.remove(service.value[0].key);
    expect(service.value.map((e) => e.catalogId)).toEqual([2]);
  });

  it('clears all entries', () => {
    service.addCard(catalogEntry({ id: 1 }));
    service.clear();
    expect(service.value).toEqual([]);
  });

  it('persists entries to localStorage', () => {
    service.addCard(catalogEntry({ id: 1 }));
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toEqual([expect.objectContaining({ catalogId: 1 })]);
  });
});
