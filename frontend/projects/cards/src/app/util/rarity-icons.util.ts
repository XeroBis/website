/** Slugifies a card_catalog.rarity value (e.g. "Rare Holo ex") into the
 * filename (without extension) expected under frontend/public/rarity-icons
 * (e.g. "rare-holo-ex.png"). Unlike pokemon-type-icons.util's fixed map,
 * rarity has ~40 distinct values and gains new ones over time, so this
 * derives the filename directly instead of hardcoding every entry --
 * rarities with no icon dropped in yet just fall back to a text badge. */
export function raritySlug(rarity: string): string {
  return rarity
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function rarityIconUrl(rarity: string): string {
  return `/rarity-icons/${raritySlug(rarity)}.png`;
}
