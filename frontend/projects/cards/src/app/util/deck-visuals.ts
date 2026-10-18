import { DeckCard } from '../models/deck.model';

export interface EnergyBadge {
  key: string;
  label: string;
  icon: string | null;
}

const BASIC_ENERGY_LETTER: Record<string, { key: string; label: string }> = {
  g: { key: 'grass', label: 'Grass' },
  r: { key: 'fire', label: 'Fire' },
  w: { key: 'water', label: 'Water' },
  l: { key: 'electric', label: 'Lightning' },
  p: { key: 'psychic', label: 'Psychic' },
  f: { key: 'fighting', label: 'Fighting' },
  d: { key: 'dark', label: 'Darkness' },
  m: { key: 'steel', label: 'Metal' },
};

const ENERGY_KEYWORD: [RegExp, { key: string; label: string }][] = [
  [/darkness/i, { key: 'dark', label: 'Darkness' }],
  [/lightning/i, { key: 'electric', label: 'Lightning' }],
  [/colorless/i, { key: 'normal', label: 'Colorless' }],
  [/metal/i, { key: 'steel', label: 'Metal' }],
  [/grass/i, { key: 'grass', label: 'Grass' }],
  [/\bfire\b/i, { key: 'fire', label: 'Fire' }],
  [/water/i, { key: 'water', label: 'Water' }],
  [/psychic/i, { key: 'psychic', label: 'Psychic' }],
  [/fighting/i, { key: 'fighting', label: 'Fighting' }],
  [/dragon/i, { key: 'dragon', label: 'Dragon' }],
  [/fairy/i, { key: 'fairy', label: 'Fairy' }],
];

const BASIC_ENERGY_NAMES = new Set([
  'Grass Energy',
  'Fire Energy',
  'Water Energy',
  'Lightning Energy',
  'Psychic Energy',
  'Fighting Energy',
  'Darkness Energy',
  'Metal Energy',
  'Fairy Energy',
]);

// Some prints use a legacy `Basic <letter> Energy` or `Basic <element> Energy`
// name instead of the generic element form.
const BASIC_ENERGY_LETTERS = new Set(['G', 'R', 'W', 'L', 'P', 'F', 'D', 'M', 'Y']);
const BASIC_ENERGY_WORDS = new Set(
  [...BASIC_ENERGY_NAMES].map((name) => name.replace(/ Energy$/, '')),
);

export function isBasicEnergy(cardName: string): boolean {
  const datedBasicEnergy = /^(.+ Energy) \(20\d{2}\)$/.exec(cardName)?.[1] ?? cardName;
  if (BASIC_ENERGY_NAMES.has(datedBasicEnergy)) {
    return true;
  }
  const parts = cardName.split(' ');
  return (
    parts.length === 3 &&
    parts[0] === 'Basic' &&
    (BASIC_ENERGY_LETTERS.has(parts[1]) || BASIC_ENERGY_WORDS.has(parts[1])) &&
    parts[2] === 'Energy'
  );
}

const ENERGY_ICON: Record<string, string> = {
  grass: 'grass.png',
  fire: 'fire.png',
  water: 'water.png',
  electric: 'electric.png',
  psychic: 'psychic.png',
  fighting: 'fighting.png',
  dark: 'dark.png',
  steel: 'steel.png',
  dragon: 'dragon.png',
  normal: 'normal.png',
};

function deriveEnergyBadge(cardName: string): EnergyBadge | null {
  const basicMatch = /^basic\s+([a-z])\s+energy$/i.exec(cardName.trim());
  const match = basicMatch ? BASIC_ENERGY_LETTER[basicMatch[1].toLowerCase()] : undefined;
  const found = match ?? ENERGY_KEYWORD.find(([re]) => re.test(cardName))?.[1];
  if (!found) {
    return null;
  }
  return { ...found, icon: ENERGY_ICON[found.key] ?? null };
}

/** Pads a deck's user-picked poster cards out to exactly 3 slots (`null` for
 * an unpicked slot) so the header/list row's "hand fan" can always render 3
 * fixed positions -- a real card image, or an empty placeholder slot. */
export function posterSlots(posterCards: DeckCard[]): (DeckCard | null)[] {
  return [0, 1, 2].map((i) => posterCards[i] ?? null);
}

export function computeEnergyBadges(cards: DeckCard[]): EnergyBadge[] {
  const byKey = new Map<string, EnergyBadge>();
  for (const dc of cards) {
    if (dc.supertype !== 'Energy') {
      continue;
    }
    const badge = deriveEnergyBadge(dc.name);
    if (badge && !byKey.has(badge.key)) {
      byKey.set(badge.key, badge);
    }
  }
  return Array.from(byKey.values());
}

export function energyIconUrl(icon: string): string {
  return `/energy-icons/${icon}`;
}

export interface SupertypeCounts {
  pokemon: number;
  trainer: number;
  energy: number;
}

export function computeSupertypeCounts(
  cards: { supertype: string | null; quantity_in_deck: number }[],
): SupertypeCounts {
  const counts: SupertypeCounts = { pokemon: 0, trainer: 0, energy: 0 };
  for (const dc of cards) {
    switch (dc.supertype) {
      case 'Pokémon':
        counts.pokemon += dc.quantity_in_deck;
        break;
      case 'Trainer':
        counts.trainer += dc.quantity_in_deck;
        break;
      case 'Energy':
        counts.energy += dc.quantity_in_deck;
        break;
    }
  }
  return counts;
}
