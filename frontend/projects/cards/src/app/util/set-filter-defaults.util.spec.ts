import { lacksDefaultRarities } from './set-filter-defaults.util';

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
});
