import { nextMinOwned, selectDisplayedPrints } from './variant-display.util';

describe('owned filter', () => {
  it('cycles off → +1 → +2 → off', () => {
    expect(nextMinOwned(0)).toBe(1);
    expect(nextMinOwned(1)).toBe(2);
    expect(nextMinOwned(2)).toBe(0);
  });

  it('keeps the selected prints owned at least that many times', () => {
    const prints = [
      { variant_type: 'standard', owned: 0 },
      { variant_type: 'reverse', owned: 1 },
      { variant_type: 'reverse_pokeball', owned: 3 },
    ];
    const shown = (min: 0 | 1 | 2, selected: string[] = []) =>
      selectDisplayedPrints(prints, selected, min, (p) => p.owned).map((p) => p.variant_type);
    expect(shown(0)).toEqual(['standard', 'reverse', 'reverse_pokeball']);
    expect(shown(1)).toEqual(['reverse', 'reverse_pokeball']);
    expect(shown(2)).toEqual(['reverse_pokeball']);
    expect(shown(1, ['standard', 'reverse'])).toEqual(['reverse']);
  });
});
