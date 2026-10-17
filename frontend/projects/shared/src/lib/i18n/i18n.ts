import {
  DOCUMENT,
  EnvironmentProviders,
  Injectable,
  Provider,
  computed,
  effect,
  inject,
  provideAppInitializer,
  signal,
} from '@angular/core';
import {
  TranslateLoader,
  TranslateService,
  TranslationObject,
  provideTranslateLoader,
  provideTranslateService,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';

import { AuthService } from '../auth/auth.service';
import { DEFAULT_LANGUAGE, Language, resolveLanguage } from './language';

export type Translations = Record<Language, TranslationObject>;

const STORAGE_KEY = 'language';

/** Translations bundled into the app (no HTTP fetch for them). */
class StaticLoader implements TranslateLoader {
  constructor(private readonly translations: Translations) {}

  getTranslation(lang: string): Observable<TranslationObject> {
    return of(this.translations[lang as Language] ?? this.translations[DEFAULT_LANGUAGE]);
  }
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The language the UI is shown in; see `resolveLanguage` for the order. */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);
  private readonly document = inject(DOCUMENT);
  private readonly stored = signal(readStored());

  readonly current = computed(() =>
    resolveLanguage(this.auth.user()?.language, this.stored(), this.document.defaultView?.navigator.language),
  );

  constructor() {
    effect(() => {
      const lang = this.current();
      this.translate.use(lang);
      this.document.documentElement.lang = lang;
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        // storage disabled: the language just isn't remembered
      }
    });
  }

  /** For logged-out visitors; a logged-in user's saved language wins. */
  set(lang: Language): void {
    this.stored.set(lang);
  }
}

/**
 * ngx-translate with this app's FR/EN strings, following the user's
 * language. Also starts loading the session (`AuthService.load()`).
 */
export function provideI18n(translations: Translations): (Provider | EnvironmentProviders)[] {
  return [
    provideTranslateService({
      fallbackLang: DEFAULT_LANGUAGE,
      loader: provideTranslateLoader(() => new StaticLoader(translations)),
    }),
    provideAppInitializer(() => {
      inject(LanguageService);
      inject(AuthService)
        .load()
        .catch(() => undefined); // backend down: stay anonymous
    }),
  ];
}
