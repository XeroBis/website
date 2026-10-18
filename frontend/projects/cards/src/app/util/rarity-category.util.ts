/** Maps a raw card_catalog.rarity value to the coarser category the set
 * detail page's rarity filter groups it under -- several scraped rarity
 * strings render as the exact same icon (they're all just "a fancier full
 * art/secret print" in practice), so filtering by the raw string would show
 * several visually-identical buttons. Not a DB column: purely a client-side
 * display grouping, the same "curated grouping over raw scraped value"
 * relationship CardSet.category has to series (see data-model.md's "Note on
 * GET /api/cards/catalog/sets"). Every card_catalog.rarity not listed here maps to
 * itself (its own category) -- most rarities (Common, Rare, Rare Holo, ...)
 * are already specific enough not to need collapsing.
 *
 * "No Rarity" deliberately has no entry and isn't grouped with anything --
 * it's a placeholder for cards pkmncards.com never assigned a rarity to,
 * not a real tier. */
const RARITY_CATEGORY_OVERRIDES: Record<string, string> = {
  'Amazing Rare': 'Ultra Rare',
  // The DATA source uses the French label, while the manually supplied
  // icon follows the English category filename (`futurist-rare.png`).
  'Futuriste Rare': 'Futurist Rare',
  'Holo Rare V': 'Ultra Rare',
  'Holo Rare VMAX': 'Ultra Rare',
  'Holo Rare VSTAR': 'Ultra Rare',
  LEGEND: 'Ultra Rare',
  'Radiant Rare': 'Ultra Rare',
  'Rare BREAK': 'Ultra Rare',
  'Rare Holo LV.X': 'Ultra Rare',
  'Rare Holo Star': 'Ultra Rare',
  'Rare Holo ex': 'Ultra Rare',
  'Rare HoloEX': 'Ultra Rare',
  'Rare HoloGX': 'Ultra Rare',
  'Rare Prime': 'Ultra Rare',
  'Rare Prism Star': 'Ultra Rare',
  'Rare Shining': 'Ultra Rare',
  'Rare ShinyGX': 'Ultra Rare',
  // The imported label is abbreviated, while its manually supplied icon
  // uses the expanded category filename (`rgb-rare.png`).
  RGB: 'RGB Rare',
  'Shiny Rare V or VMAX': 'Ultra Rare',
  'Special Full Art': 'Rare Secret',
  'Trainer Gallery Holo Rare': 'Rare Secret',
  'Trainer Gallery Holo Rare V': 'Rare Secret',
  'Trainer Gallery Holo Rare V or VMAX': 'Rare Secret',
  'Trainer Gallery Secret Rare': 'Rare Secret',
  'Trainer Gallery Ultra Rare': 'Rare Secret',
};

export function rarityCategory(rarity: string): string {
  return RARITY_CATEGORY_OVERRIDES[rarity] ?? rarity;
}

/** Display order for rarity filter buttons/rows, roughly common -> rare.
 * Not derived from anything (there's no numeric "rarity level" anywhere in
 * card_catalog) -- a hand-picked ladder matching how these tiers are
 * generally understood. "No Rarity" (not a real tier, see the module doc
 * above) sorts last. Any category missing from this list (shouldn't happen
 * for the ~19 categories rarityCategory() can currently produce, but stays
 * safe for a future new one) sorts after everything listed, alphabetically
 * among themselves. */
const RARITY_CATEGORY_ORDER: string[] = [
  'Common',
  'Uncommon',
  'Rare',
  'Pikachu rare',
  'Double Rare',
  'Rare Holo',
  'Illustration Rare',
  'Special Illustration Rare',
  'Ultra Rare',
  'Hyper Rare',
  'Rare Secret',
  'Shiny Rare',
  'Shiny Ultra Rare',
  'Rainbow Rare',
  'ACE SPEC Rare',
  'Black White Rare',
  'Mega Attack Rare',
  'Mega Hyper Rare',
  'Futurist Rare',
  'Secrète',
  'RGB Rare',
  'Promo',
  'No Rarity',
];

function rarityCategoryRank(category: string): number {
  const index = RARITY_CATEGORY_ORDER.indexOf(category);
  return index === -1 ? RARITY_CATEGORY_ORDER.length : index;
}

/** Sorts a list of categories by the common -> rare ladder above (unknown
 * categories last, alphabetically among themselves). */
export function sortRarityCategories(categories: Iterable<string>): string[] {
  return [...categories].sort(
    (a, b) => rarityCategoryRank(a) - rarityCategoryRank(b) || a.localeCompare(b),
  );
}

/** Distinct categories present in a list of raw rarities, ordered by the
 * common -> rare ladder above -- e.g. reducing a catalog-wide rarity list
 * down to the set of filter buttons to show. */
export function rarityCategories(rarities: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const rarity of rarities) {
    seen.add(rarityCategory(rarity));
  }
  return sortRarityCategories(seen);
}

/** Inverse of rarityCategory(): every raw card_catalog.rarity value that
 * collapses onto the given category, including the category name itself
 * (every category is also a valid raw rarity in its own right -- see the
 * module doc above). Used to expand a selected filter category back into
 * the raw values a server-side query can actually match against, since
 * card_catalog.rarity stores the raw string, not the category. */
export function rawRaritiesForCategory(category: string): string[] {
  const raw = [category];
  for (const [rarity, cat] of Object.entries(RARITY_CATEGORY_OVERRIDES)) {
    if (cat === category) {
      raw.push(rarity);
    }
  }
  return raw;
}
