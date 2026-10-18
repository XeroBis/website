const GENDER_SYMBOLS: Record<string, string> = { '♀': ' Female', '♂': ' Male' };
const PUNCTUATION_TO_STRIP = /[’'.:]/g;
const COMBINING_DIACRITICS = /[̀-ͯ]/g;

/** Mirrors backend/catalog_refresh/name_normalize.py, so a client-side name
 * match (Collection, Sets) stays consistent with the catalog's own search. */
export function normalizePokemonName(text: string): string {
  let result = text;
  for (const [symbol, word] of Object.entries(GENDER_SYMBOLS)) {
    result = result.split(symbol).join(word);
  }
  result = result.replace(PUNCTUATION_TO_STRIP, '');
  result = result.normalize('NFKD').replace(COMBINING_DIACRITICS, '');
  return result.replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface AnchoredSearch {
  term: string;
  startsWith: boolean;
  endsWith: boolean;
}

/** Mirrors backend/routers/catalog.py's `^`/`$` anchor parsing: a leading
 * `^` requires a start-of-name match and a trailing `$` an end-of-name
 * match, so client-side search (Collection, Sets) stays in sync with the
 * catalog's server-side search. */
export function parseAnchoredSearch(search: string): AnchoredSearch {
  let term = search;
  const startsWith = term.startsWith('^');
  if (startsWith) {
    term = term.slice(1);
  }
  const endsWith = term.endsWith('$');
  if (endsWith) {
    term = term.slice(0, -1);
  }
  return { term, startsWith, endsWith };
}

export function matchesAnchored(value: string, anchored: AnchoredSearch): boolean {
  const { term, startsWith, endsWith } = anchored;
  if (startsWith && endsWith) {
    return value === term;
  }
  if (startsWith) {
    return value.startsWith(term);
  }
  if (endsWith) {
    return value.endsWith(term);
  }
  return value.includes(term);
}

/** True if `cardName` matches `search` the same way the catalog's backend
 * search does: partial/case-insensitive by default, anchored with `^`/`$`.
 * Used by pages that filter an already-loaded card list client-side
 * (Collection, Sets) instead of calling `GET /api/cards/catalog`. */
export function matchesCatalogSearch(cardName: string, search: string): boolean {
  const trimmed = search.trim();
  if (!trimmed) {
    return true;
  }
  const { term, startsWith, endsWith } = parseAnchoredSearch(trimmed);
  const normalizedTerm = normalizePokemonName(term);
  if (!normalizedTerm) {
    return true;
  }
  const nameNormalized = normalizePokemonName(cardName);
  return matchesAnchored(nameNormalized, { term: normalizedTerm, startsWith, endsWith });
}
