/** A run of pages, 1-based and inclusive: `[3, 5]` is pages 3, 4 and 5. */
export type PageRange = readonly [number, number];

export interface ParsedRanges {
  /** The ranges as typed, in order (a reversed `5-3` becomes `[3, 5]`). */
  ranges: PageRange[];
  /** Every page they cover, sorted, once each. */
  pages: number[];
  /** The parts that aren't a page or range within 1..max, as typed. */
  invalid: string[];
}

/** Reads `1-3, 7, 10-12` for a document of `max` pages. Empty parts are ignored. */
export function parseRanges(text: string, max: number): ParsedRanges {
  const ranges: PageRange[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) {
      invalid.push(part);
      continue;
    }
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    const [from, to] = a <= b ? [a, b] : [b, a];
    if (from < 1 || to > max) {
      invalid.push(part);
      continue;
    }
    ranges.push([from, to]);
  }
  const set = new Set<number>();
  for (const [from, to] of ranges) for (let p = from; p <= to; p++) set.add(p);
  return { ranges, pages: [...set].sort((x, y) => x - y), invalid };
}

/** Groups pages into consecutive runs: `[1, 2, 3, 7]` → `[[1, 3], [7, 7]]`. */
export function toRanges(pages: Iterable<number>): PageRange[] {
  const sorted = [...new Set(pages)].sort((x, y) => x - y);
  const out: PageRange[] = [];
  for (const p of sorted) {
    const last = out.at(-1);
    if (last && last[1] === p - 1) out[out.length - 1] = [last[0], p];
    else out.push([p, p]);
  }
  return out;
}

/** `[[1, 3], [7, 7]]` → `1-3, 7`. */
export function formatRanges(ranges: readonly PageRange[]): string {
  return ranges.map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`)).join(', ');
}
