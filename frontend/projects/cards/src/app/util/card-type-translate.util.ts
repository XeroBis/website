const SUPERTYPE_KEYS: Record<string, string> = {
  Pokémon: 'pokemon',
  Trainer: 'trainer',
  Energy: 'energy',
};

/** Maps a raw `card_catalog.supertype` value to its i18n key; falls back to the raw value if unrecognized. */
export function supertypeKey(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const key = SUPERTYPE_KEYS[value];
  return key ? `common.cardTypes.${key}` : value;
}
