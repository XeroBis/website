export const LANGUAGES = ['fr', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'fr';

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language);
}

/**
 * The logged-in user's language wins; otherwise the last one used on this
 * site (localStorage), then the browser's, then French.
 */
export function resolveLanguage(
  userLanguage: Language | null | undefined,
  stored: string | null,
  browser: string | undefined,
): Language {
  if (userLanguage) return userLanguage;
  if (isLanguage(stored)) return stored;
  const browserLanguage = browser?.slice(0, 2).toLowerCase();
  return isLanguage(browserLanguage) ? browserLanguage : DEFAULT_LANGUAGE;
}
