import { VariantType } from '../models/card.model';
import { rarityCategory } from './rarity-category.util';

/** Initial completion filters shared by the Sets overview and individual sets. */
export const DEFAULT_SET_RARITIES = ['Common', 'Uncommon', 'Rare', 'Pikachu rare', 'Double Rare'];

/** Extra rarities a set page of these series opens on: Sword & Shield has no
 * Double Rare, its V/VMAX/VSTAR cards fall under Ultra Rare. */
const SERIES_EXTRA_RARITIES: Record<string, string[]> = {
  'Sword & Shield': ['Rare Holo', 'Ultra Rare'],
};

/** The rarities a set page opens on, for the set's series. */
export function defaultSetRarities(series: string | null | undefined): string[] {
  return [...DEFAULT_SET_RARITIES, ...(SERIES_EXTRA_RARITIES[series ?? ''] ?? [])];
}

export const DEFAULT_SET_VARIANTS: VariantType[] = [
  'standard',
  'reverse',
  'reverse_pokeball',
  'reverse_friendball',
  'reverse_loveball',
  'reverse_duskball',
  'reverse_quickball',
  'reverse_rocketball',
];

/** True when none of the set's cards falls in `defaults` (energy and promo
 * sets: only "No Rarity" or "Promo"). Such a set opens with both filters on
 * "all" instead of an empty page. Takes raw rarities. */
export function lacksDefaultRarities(
  rarities: (string | null | undefined)[],
  defaults: string[] = DEFAULT_SET_RARITIES,
): boolean {
  return !rarities.some((rarity) => !!rarity && defaults.includes(rarityCategory(rarity)));
}
