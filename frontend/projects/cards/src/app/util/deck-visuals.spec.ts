import { DeckCard } from '../models/deck.model';
import {
  computeEnergyBadges,
  computeSupertypeCounts,
  energyIconUrl,
  isBasicEnergy,
} from './deck-visuals';

function deckCard(overrides: Partial<DeckCard>): DeckCard {
  return {
    id: 1,
    card_id: 1,
    catalog_id: 1,
    variant_type: 'standard',
    quantity_in_deck: 1,
    name: 'Test Card',
    set_name: 'Base',
    image_path: '/x.png',
    available: 1,
    owned: 1,
    allocated_decks: [],
    supertype: null,
    ...overrides,
  };
}

describe('isBasicEnergy', () => {
  it('recognizes full basic energy names', () => {
    expect(isBasicEnergy('Fire Energy')).toBe(true);
    expect(isBasicEnergy('Grass Energy')).toBe(true);
  });

  it('recognizes single-letter-abbreviation basic energy names', () => {
    expect(isBasicEnergy('Basic G Energy')).toBe(true);
    expect(isBasicEnergy('Basic Y Energy')).toBe(true);
  });

  it('recognizes full-word basic energy names', () => {
    expect(isBasicEnergy('Basic Fighting Energy')).toBe(true);
    expect(isBasicEnergy('Psychic Energy (2024)')).toBe(true);
  });

  it('rejects non-basic-energy names', () => {
    expect(isBasicEnergy('Double Colorless Energy')).toBe(false);
    expect(isBasicEnergy('Charizard')).toBe(false);
    expect(isBasicEnergy('Basic Z Energy')).toBe(false);
  });
});

describe('computeEnergyBadges', () => {
  it('ignores non-Energy cards', () => {
    const cards = [deckCard({ name: 'Fire Energy', supertype: 'Pokémon' })];
    expect(computeEnergyBadges(cards)).toEqual([]);
  });

  it('derives a badge per distinct energy type and dedupes repeats', () => {
    const cards = [
      deckCard({ name: 'Fire Energy', supertype: 'Energy' }),
      deckCard({ name: 'Fire Energy', supertype: 'Energy' }),
      deckCard({ name: 'Basic G Energy', supertype: 'Energy' }),
    ];
    const badges = computeEnergyBadges(cards);
    expect(badges.map((b) => b.key).sort()).toEqual(['fire', 'grass']);
  });

  it('ignores energy cards with no recognizable type', () => {
    const cards = [deckCard({ name: 'Some Special Energy', supertype: 'Energy' })];
    expect(computeEnergyBadges(cards)).toEqual([]);
  });
});

describe('energyIconUrl', () => {
  it('builds the icon path', () => {
    expect(energyIconUrl('fire.png')).toBe('/energy-icons/fire.png');
  });
});

describe('computeSupertypeCounts', () => {
  it('sums quantity_in_deck per supertype', () => {
    const cards = [
      { supertype: 'Pokémon', quantity_in_deck: 4 },
      { supertype: 'Pokémon', quantity_in_deck: 2 },
      { supertype: 'Trainer', quantity_in_deck: 10 },
      { supertype: 'Energy', quantity_in_deck: 8 },
      { supertype: null, quantity_in_deck: 99 },
    ];
    expect(computeSupertypeCounts(cards)).toEqual({ pokemon: 6, trainer: 10, energy: 8 });
  });

  it('returns zeros for an empty list', () => {
    expect(computeSupertypeCounts([])).toEqual({ pokemon: 0, trainer: 0, energy: 0 });
  });
});
