import { matchesCatalogSearch, normalizePokemonName } from './pokemon-translations.util';

describe('normalizePokemonName', () => {
  it('lowercases and trims', () => {
    expect(normalizePokemonName('  Pikachu  ')).toBe('pikachu');
  });

  it('expands gender symbols', () => {
    expect(normalizePokemonName('Nidoran♀')).toBe('nidoran female');
    expect(normalizePokemonName('Nidoran♂')).toBe('nidoran male');
  });

  it('strips punctuation', () => {
    expect(normalizePokemonName("Farfetch'd")).toBe('farfetchd');
    expect(normalizePokemonName('Mr. Mime')).toBe('mr mime');
    expect(normalizePokemonName('Porygon:Z')).toBe('porygonz');
  });

  it('strips combining diacritics after NFKD normalization', () => {
    expect(normalizePokemonName('Flabébé')).toBe('flabebe');
  });

  it('collapses repeated whitespace', () => {
    expect(normalizePokemonName('Mr   Mime')).toBe('mr mime');
  });
});

describe('matchesCatalogSearch', () => {
  it('matches a plain substring, case-insensitive', () => {
    expect(matchesCatalogSearch('Pikachu ex', 'pika')).toBe(true);
    expect(matchesCatalogSearch('Pikachu ex', 'zzz')).toBe(false);
  });

  it('anchors to the start of the name with a leading ^', () => {
    expect(matchesCatalogSearch('Pikachu', '^Pika')).toBe(true);
    expect(matchesCatalogSearch('Raichu', '^Pika')).toBe(false);
    expect(matchesCatalogSearch('Ash’s Pikachu', '^Pika')).toBe(false);
  });

  it('anchors to the end of the name with a trailing $', () => {
    expect(matchesCatalogSearch('Pikachu', 'chu$')).toBe(true);
    expect(matchesCatalogSearch('Charizard', 'chu$')).toBe(false);
  });

  it('requires an exact match with both ^ and $', () => {
    expect(matchesCatalogSearch('Pikachu', '^Pikachu$')).toBe(true);
    expect(matchesCatalogSearch('Pikachu V', '^Pikachu$')).toBe(false);
  });

  it('treats a blank search as matching everything', () => {
    expect(matchesCatalogSearch('Pikachu', '  ')).toBe(true);
  });
});
