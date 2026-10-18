import { sortCards, SortOption } from './sort.util';

interface TestCard {
  name: string;
  supertype?: string | null;
  set_name?: string | null;
  release_date?: string | null;
}

describe('sortCards', () => {
  const cards: TestCard[] = [
    { name: 'Pikachu', supertype: 'Pokémon' },
    { name: 'Charizard', supertype: 'Pokémon' },
    { name: 'Bulbasaur', supertype: 'Pokémon' },
    { name: 'Potion', supertype: 'Trainer' },
  ];

  const setCards: TestCard[] = [
    { name: 'Pikachu', set_name: 'Base Set', release_date: '1999-01-09' },
    { name: 'Charizard', set_name: '151', release_date: '2023-06-16' },
    { name: 'Bulbasaur', set_name: 'Celebrations', release_date: null },
  ];

  it('does not mutate the input array', () => {
    const original = [...cards];
    sortCards(cards, 'name_asc');
    expect(cards).toEqual(original);
  });

  it('sorts by name ascending', () => {
    const result = sortCards(cards, 'name_asc');
    expect(result.map((c) => c.name)).toEqual(['Bulbasaur', 'Charizard', 'Pikachu', 'Potion']);
  });

  it('sorts by name descending', () => {
    const result = sortCards(cards, 'name_desc');
    expect(result.map((c) => c.name)).toEqual(['Potion', 'Pikachu', 'Charizard', 'Bulbasaur']);
  });

  it('sorts by supertype, then name as tiebreaker', () => {
    const result = sortCards(cards, 'supertype');
    expect(result.map((c) => c.name)).toEqual(['Bulbasaur', 'Charizard', 'Pikachu', 'Potion']);
  });

  it('sorts by set release date ascending, undated sets first', () => {
    const result = sortCards(setCards, 'set_release_asc');
    expect(result.map((c) => c.set_name)).toEqual(['Celebrations', 'Base Set', '151']);
  });

  it('sorts by set release date descending, undated sets last', () => {
    const result = sortCards(setCards, 'set_release_desc');
    expect(result.map((c) => c.set_name)).toEqual(['151', 'Base Set', 'Celebrations']);
  });

  it('sorts by set name ascending', () => {
    const result = sortCards(setCards, 'set_name_asc');
    expect(result.map((c) => c.set_name)).toEqual(['151', 'Base Set', 'Celebrations']);
  });

  it('sorts by set name descending', () => {
    const result = sortCards(setCards, 'set_name_desc');
    expect(result.map((c) => c.set_name)).toEqual(['Celebrations', 'Base Set', '151']);
  });

  it('defaults to name ascending for an unrecognized option', () => {
    const result = sortCards(cards, 'unknown' as SortOption);
    expect(result.map((c) => c.name)).toEqual(['Bulbasaur', 'Charizard', 'Pikachu', 'Potion']);
  });
});
