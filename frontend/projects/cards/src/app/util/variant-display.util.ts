/** Shared logic behind the "show variants" toggle button on both the set
 * detail page and the public shared-set page -- see
 * documentation/features.md's "Show variants toggle". Kept here (rather than
 * duplicated in each component) so both pages toggle/count/filter identically. */
export type VariantDisplayMode = 'standard' | 'both';

/** standard -> both -> standard, one step per click. */
export function cycleVariantDisplayMode(mode: VariantDisplayMode): VariantDisplayMode {
  return mode === 'standard' ? 'both' : 'standard';
}

interface VariantLike {
  variant_type: string;
}

/** Flattens `entries` into one (entry, variant) tile per print variant the
 * entry's own catalog variants list. Not called for 'standard' mode, whose
 * caller renders one tile per entry directly instead. */
export function buildVariantTiles<TEntry, TVariant extends VariantLike>(
  entries: TEntry[],
  getVariants: (entry: TEntry) => TVariant[],
): { entry: TEntry; variant: TVariant }[] {
  const tiles: { entry: TEntry; variant: TVariant }[] = [];
  for (const entry of entries) {
    for (const variant of getVariants(entry)) {
      tiles.push({ entry, variant });
    }
  }
  return tiles;
}

/** Rounded percentage of `ownedCount` out of `totalCount`, 0 when there's
 * nothing to show -- same rounding rule wherever a completion bar/label is
 * computed in this app. */
export function completionPercent(ownedCount: number, totalCount: number): number {
  if (totalCount === 0) {
    return 0;
  }
  return Math.round((ownedCount / totalCount) * 100);
}

/** Empty print selection means all; individual buttons toggle independently. */
export function togglePrintSelection<T extends string>(selected: T[], value: T | 'all'): T[] {
  return value === 'all'
    ? []
    : selected.includes(value as T)
      ? selected.filter((type) => type !== value)
      : [...selected, value as T];
}

export function printSelectionMode(selected: string[]): VariantDisplayMode {
  return selected.length === 1 && selected[0] === 'standard' ? 'standard' : 'both';
}

/** Shared personal/public filtering, including exact-print duplicate quantities. */
export function selectDisplayedPrints<T extends VariantLike>(
  variants: T[],
  selected: string[],
  duplicatesOnly: boolean,
  quantity: (variant: T) => number,
): T[] {
  return variants.filter(
    (variant) =>
      (selected.length === 0 || selected.includes(variant.variant_type)) &&
      (!duplicatesOnly || quantity(variant) >= 2),
  );
}
