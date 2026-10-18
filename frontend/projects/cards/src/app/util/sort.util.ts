/** 'supertype' is a client-only grouping order (Pokémon/Trainer/Energy, see
 * SUPERTYPE_RANK below) used by the Deck Upgrade Drafts unified card list --
 * not one of the backend's SORT_OPTIONS (catalog_search.py), so it's never
 * offered in the Browse/Collection sort dropdown (SORT_OPTIONS below) or
 * sent as a `sort` query param. */
export type SortOption =
  | 'name_asc'
  | 'name_desc'
  | 'supertype'
  | 'card_number_asc'
  | 'card_number_desc'
  | 'set_release_asc'
  | 'set_release_desc'
  | 'set_name_asc'
  | 'set_name_desc';

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'name_asc', label: 'Name (A-Z)' },
  { value: 'name_desc', label: 'Name (Z-A)' },
  { value: 'card_number_asc', label: 'Card # (Low to High)' },
  { value: 'card_number_desc', label: 'Card # (High to Low)' },
  { value: 'set_release_asc', label: 'Set (Oldest to Newest)' },
  { value: 'set_release_desc', label: 'Set (Newest to Oldest)' },
  { value: 'set_name_asc', label: 'Set (A-Z)' },
  { value: 'set_name_desc', label: 'Set (Z-A)' },
];

interface Sortable {
  name: string;
  supertype?: string | null;
  card_number?: string | null;
  set_name?: string | null;
  release_date?: string | null;
}

const SUPERTYPE_RANK: Record<string, number> = {
  Pokémon: 0,
  Trainer: 1,
  Energy: 2,
};

/** card_number is text (secret rares like "TG01" aren't numeric), so a plain
 * string sort would put "10" before "2" -- numeric numbers sort as numbers,
 * with non-numeric ones sorted after, mirroring the backend's
 * _numeric_card_number (backend/routers/catalog.py). */
function compareCardNumber(a: string | null | undefined, b: string | null | undefined): number {
  const numA = a && /^\d+$/.test(a) ? Number(a) : null;
  const numB = b && /^\d+$/.test(b) ? Number(b) : null;
  if (numA !== null && numB !== null) return numA - numB;
  if (numA !== null) return -1;
  if (numB !== null) return 1;
  return (a ?? '').localeCompare(b ?? '');
}

/** ISO date strings compare correctly with plain string comparison. A set
 * with no release_date on record sorts as the oldest set -- ascending
 * (oldest-first) puts undated sets first, mirroring the backend's
 * asc(release_date).nulls_first() in _order_by (backend/routers/catalog.py).
 * `a`/`b` are already in the desired direction by the caller (swapped for
 * descending), so this always compares "a older than b". */
function compareReleaseDate(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b);
}

/** By default sorts/tiebreaks on the raw `name` field; pass `getName` (e.g.
 * CardNameService.displayName) to sort by the name actually shown to the
 * user instead, so a French-named card doesn't get ordered as if it were
 * still its English name. */
export function sortCards<T extends Sortable>(
  cards: T[],
  sort: SortOption,
  getName: (card: T) => string = (card) => card.name,
): T[] {
  const sorted = [...cards];
  const name = (card: T) => getName(card);
  switch (sort) {
    case 'name_desc':
      sorted.sort((a, b) => name(b).localeCompare(name(a)));
      break;
    case 'supertype':
      sorted.sort((a, b) => {
        const rankA = SUPERTYPE_RANK[a.supertype ?? ''] ?? 3;
        const rankB = SUPERTYPE_RANK[b.supertype ?? ''] ?? 3;
        return rankA - rankB || name(a).localeCompare(name(b));
      });
      break;
    case 'card_number_asc':
      sorted.sort(
        (a, b) => compareCardNumber(a.card_number, b.card_number) || name(a).localeCompare(name(b)),
      );
      break;
    case 'card_number_desc':
      sorted.sort(
        (a, b) => compareCardNumber(b.card_number, a.card_number) || name(a).localeCompare(name(b)),
      );
      break;
    case 'set_release_asc':
      sorted.sort(
        (a, b) =>
          compareReleaseDate(a.release_date, b.release_date) ||
          (a.set_name ?? '').localeCompare(b.set_name ?? '') ||
          compareCardNumber(a.card_number, b.card_number) ||
          name(a).localeCompare(name(b)),
      );
      break;
    case 'set_release_desc':
      sorted.sort(
        (a, b) =>
          compareReleaseDate(b.release_date, a.release_date) ||
          (a.set_name ?? '').localeCompare(b.set_name ?? '') ||
          compareCardNumber(a.card_number, b.card_number) ||
          name(a).localeCompare(name(b)),
      );
      break;
    case 'set_name_asc':
      sorted.sort(
        (a, b) =>
          (a.set_name ?? '').localeCompare(b.set_name ?? '') ||
          compareCardNumber(a.card_number, b.card_number) ||
          name(a).localeCompare(name(b)),
      );
      break;
    case 'set_name_desc':
      sorted.sort(
        (a, b) =>
          (b.set_name ?? '').localeCompare(a.set_name ?? '') ||
          compareCardNumber(a.card_number, b.card_number) ||
          name(a).localeCompare(name(b)),
      );
      break;
    case 'name_asc':
    default:
      sorted.sort((a, b) => name(a).localeCompare(name(b)));
      break;
  }
  return sorted;
}
