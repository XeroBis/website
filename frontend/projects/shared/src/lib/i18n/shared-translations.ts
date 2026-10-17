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
    },
  },
  en: {
    SHARED: {
      LOGIN: 'Log in',
      ACCOUNT: 'My account',
      LANGUAGE: 'Language',
    },
  },
};
