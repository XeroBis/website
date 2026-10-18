import type { Translations } from './i18n';

/**
 * Strings used by `@shared` components (header…), merged under `SHARED` into
 * every app's own translations by `provideI18n`.
 */
export const SHARED_TRANSLATIONS: Translations = {
  fr: {
    SHARED: {
      LOGIN: 'Se connecter',
      ACCOUNT: 'Mon compte',
      LANGUAGE: 'Langue',
      MENU: 'Menu',
      THEME: 'Thème : {{name}}',
      THEME_SYSTEM: 'Système',
      THEME_LIGHT: 'Clair',
      THEME_DARK: 'Sombre',
    },
  },
  en: {
    SHARED: {
      LOGIN: 'Log in',
      ACCOUNT: 'My account',
      LANGUAGE: 'Language',
      MENU: 'Menu',
      THEME: 'Theme: {{name}}',
      THEME_SYSTEM: 'System',
      THEME_LIGHT: 'Light',
      THEME_DARK: 'Dark',
    },
  },
};
