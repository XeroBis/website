import { defaultSetRarities, lacksDefaultRarities } from './set-filter-defaults.util';

describe('lacksDefaultRarities', () => {
  it('is true for energy and promo sets', () => {
    expect(lacksDefaultRarities(['No Rarity', null])).toBe(true);
    expect(lacksDefaultRarities(['Promo'])).toBe(true);
    expect(lacksDefaultRarities([])).toBe(true);
  });

  it('is false once one card has a default rarity', () => {
    expect(lacksDefaultRarities(['Promo', 'Common'])).toBe(false);
    expect(lacksDefaultRarities(['Double Rare'])).toBe(false);
  });

  it('uses the given defaults', () => {
    expect(lacksDefaultRarities(['Holo Rare V'])).toBe(true);
    expect(lacksDefaultRarities(['Holo Rare V'], defaultSetRarities('Sword & Shield'))).toBe(false);
  });
});

describe('defaultSetRarities', () => {
  it('adds Rare Holo and Ultra Rare for Sword & Shield', () => {
    expect(defaultSetRarities('Sword & Shield')).toEqual([
      'Common',
      'Uncommon',
      'Rare',
      'Pikachu rare',
      'Double Rare',
      'Rare Holo',
      'Ultra Rare',
    ]);
  });

  it('keeps the shared defaults for other series', () => {
    expect(defaultSetRarities('Scarlet & Violet')).toEqual([
      'Common',
      'Uncommon',
      'Rare',
      'Pikachu rare',
      'Double Rare',
    ]);
    expect(defaultSetRarities(null)).toHaveLength(5);
  });
});
