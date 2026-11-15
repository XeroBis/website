import { formatRanges, parseRanges, toRanges } from './ranges';

describe('parseRanges', () => {
  it('reads pages and ranges, keeping the ranges as typed', () => {
    expect(parseRanges('1-3, 7,10 - 12', 12)).toEqual({
      ranges: [
        [1, 3],
        [7, 7],
        [10, 12],
      ],
      pages: [1, 2, 3, 7, 10, 11, 12],
      invalid: [],
    });
  });

  it('turns a reversed range around and counts overlapping pages once', () => {
    const parsed = parseRanges('5-3, 4', 9);
    expect(parsed.ranges).toEqual([
      [3, 5],
      [4, 4],
    ]);
    expect(parsed.pages).toEqual([3, 4, 5]);
  });

  it('flags what is not a page within 1..max, and ignores empty parts', () => {
    expect(parseRanges('0, 2, abc, 3-9, , 1-', 8)).toEqual({
      ranges: [[2, 2]],
      pages: [2],
      invalid: ['0', 'abc', '3-9', '1-'],
    });
    expect(parseRanges('', 8)).toEqual({ ranges: [], pages: [], invalid: [] });
  });
});

describe('toRanges / formatRanges', () => {
  it('groups pages into runs and writes them compactly', () => {
    expect(toRanges([7, 1, 3, 2, 2, 9, 10])).toEqual([
      [1, 3],
      [7, 7],
      [9, 10],
    ]);
    expect(formatRanges(toRanges([7, 1, 3, 2, 9, 10]))).toBe('1-3, 7, 9-10');
    expect(formatRanges([])).toBe('');
  });
});
