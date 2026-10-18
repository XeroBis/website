import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  RouteReuseStrategy,
  TitleStrategy,
} from '@angular/router';

import { authInterceptor, provideI18n } from '@shared';

import en from '../i18n/en.json';
import fr from '../i18n/fr.json';
import { CardsRouteReuseStrategy } from './language-routes';
import { routes } from './app.routes';
import { TranslatedTitleStrategy } from './title-strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: RouteReuseStrategy, useClass: CardsRouteReuseStrategy },
    provideI18n({ en, fr }),
    provideRouter(routes, withComponentInputBinding()),
    { provide: TitleStrategy, useClass: TranslatedTitleStrategy },
    provideHttpClient(withXhr(), withInterceptors([authInterceptor])),
  ],
};
