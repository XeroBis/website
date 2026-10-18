import { supertypeKey } from './card-type-translate.util';

describe('supertypeKey', () => {
  it('maps known supertypes to their i18n key', () => {
    expect(supertypeKey('Pokémon')).toBe('common.cardTypes.pokemon');
    expect(supertypeKey('Trainer')).toBe('common.cardTypes.trainer');
    expect(supertypeKey('Energy')).toBe('common.cardTypes.energy');
  });

  it('falls back to the raw value for unrecognized input', () => {
    expect(supertypeKey('Mystery')).toBe('Mystery');
  });

  it('returns an empty string for null/undefined', () => {
    expect(supertypeKey(null)).toBe('');
    expect(supertypeKey(undefined)).toBe('');
  });
});
