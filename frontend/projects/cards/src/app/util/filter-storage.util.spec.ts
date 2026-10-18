import { loadStoredFilters, normalizeMultiFilter, saveStoredFilters } from './filter-storage.util';

describe('loadStoredFilters', () => {
  const KEY = 'test:filters';

  afterEach(() => localStorage.removeItem(KEY));

  it('returns null when not running in the browser', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 1 }));
    expect(loadStoredFilters(false, KEY)).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(loadStoredFilters(true, KEY)).toBeNull();
  });

  it('parses stored JSON', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 1 }));
    expect(loadStoredFilters(true, KEY)).toEqual({ a: 1 });
  });

  it('returns null on corrupt JSON instead of throwing', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadStoredFilters(true, KEY)).toBeNull();
  });
});

describe('saveStoredFilters', () => {
  const KEY = 'test:filters-save';

  afterEach(() => localStorage.removeItem(KEY));

  it('does nothing when not running in the browser', () => {
    saveStoredFilters(false, KEY, { a: 1 });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('serializes and stores the value', () => {
    saveStoredFilters(true, KEY, { a: 1 });
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify({ a: 1 }));
  });
});

describe('normalizeMultiFilter', () => {
  it('returns arrays as-is', () => {
    expect(normalizeMultiFilter(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('wraps a non-empty string in an array', () => {
    expect(normalizeMultiFilter('a')).toEqual(['a']);
  });

  it('returns an empty array for an empty string', () => {
    expect(normalizeMultiFilter('')).toEqual([]);
  });

  it('returns an empty array for undefined/null', () => {
    expect(normalizeMultiFilter(undefined)).toEqual([]);
    expect(normalizeMultiFilter(null)).toEqual([]);
  });
});
