import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import localeFr from '@angular/common/locales/fr';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
} from '@angular/router';

import { authInterceptor, provideI18n } from '@shared';

import en from '../i18n/en.json';
import fr from '../i18n/fr.json';
import { routes } from './app.routes';
import { TranslatedTitleStrategy } from './title-strategy';

// For DatePipe / DecimalPipe in French ("5 oct. 2026", "42,5").
registerLocaleData(localeFr);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    { provide: TitleStrategy, useClass: TranslatedTitleStrategy },
    provideHttpClient(withInterceptors([authInterceptor])),
    provideI18n({ en, fr }),
  ],
};
