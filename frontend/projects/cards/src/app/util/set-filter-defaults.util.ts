import { VariantType } from '../models/card.model';

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
  'reverse_masterball',
];
