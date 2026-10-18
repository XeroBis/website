export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = 'system';
/** Shared by every app (Domain `.alanbignon.com` in prod); read before boot by `index.html`. */
export const THEME_COOKIE = 'theme';

export function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme);
}

/** The logged-in user's theme wins; otherwise the cookie's, then System. */
export function resolveTheme(userTheme: Theme | null | undefined, stored: string | null): Theme {
  if (userTheme) return userTheme;
  return isTheme(stored) ? stored : DEFAULT_THEME;
}

/**
 * `data-theme` on `<html>` for a forced theme (none for System, so the
 * `prefers-color-scheme` rules apply), and the matching `theme-color` meta.
 * Each `index.html` inlines the same steps, run before Angular boots.
 */
export function applyTheme(document: Document, theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"][data-scheme]')) {
    const scheme = meta.dataset['scheme'];
    meta.media =
      theme === 'system' ? `(prefers-color-scheme: ${scheme})` : scheme === theme ? 'all' : 'not all';
  }
}
