import { VariantType } from '../models/card.model';
import { rarityCategory } from './rarity-category.util';

/** Initial completion filters shared by the Sets overview and individual sets. */
export const DEFAULT_SET_RARITIES = ['Common', 'Uncommon', 'Rare', 'Pikachu rare', 'Double Rare'];

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

/** True when none of the set's cards falls in DEFAULT_SET_RARITIES (energy
 * and promo sets: only "No Rarity" or "Promo"). Such a set opens with both
 * filters on "all" instead of an empty page. Takes raw rarities. */
export function lacksDefaultRarities(rarities: (string | null | undefined)[]): boolean {
  return !rarities.some((rarity) => !!rarity && DEFAULT_SET_RARITIES.includes(rarityCategory(rarity)));
}
