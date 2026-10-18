import {
  rarityCategory,
  rawRaritiesForCategory,
  sortRarityCategories,
} from './rarity-category.util';

describe('rarity categories', () => {
  it('maps the imported French Futuriste rarity to its supplied icon category', () => {
    expect(rarityCategory('Futuriste Rare')).toBe('Futurist Rare');
    expect(rawRaritiesForCategory('Futurist Rare')).toEqual(['Futurist Rare', 'Futuriste Rare']);
  });

  it('maps the abbreviated RGB rarity to its supplied icon category', () => {
    expect(rarityCategory('RGB')).toBe('RGB Rare');
    expect(rawRaritiesForCategory('RGB Rare')).toEqual(['RGB Rare', 'RGB']);
  });

  it('orders the new Mega Evolution rarity categories before promos', () => {
    expect(
      sortRarityCategories(['RGB Rare', 'Promo', 'Secrète', 'Futurist Rare', 'Pikachu rare']),
    ).toEqual(['Pikachu rare', 'Futurist Rare', 'Secrète', 'RGB Rare', 'Promo']);
  });
});
