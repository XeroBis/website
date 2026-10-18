import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Routes, provideRouter } from '@angular/router';

import { User, provideI18n } from '@shared';

import en from '../i18n/en.json';
import fr from '../i18n/fr.json';
import { Project } from './projects.service';

// Spec helpers.

export const USER: User = {
  id: 1,
  email: 'user@example.com',
  pseudo: 'Testy',
  language: 'fr',
  theme: 'system',
  is_admin: false,
  apps: [],
};
/** Can edit the portfolio, through the grant (not admin). */
export const EDITOR: User = { ...USER, email: 'editor@example.com', apps: ['portfolio'] };

export const PROJECT: Project = {
  id: 3,
  name: 'Cards',
  description_fr: 'Collection de cartes',
  description_en: 'Card collection',
  repo_url: 'https://github.com/XeroBis/pkm_cards',
  featured: false,
  position: 0,
  tags: ['Angular', 'FastAPI'],
};

/** The app's real providers, with a fake backend. Language starts as French. */
export function setup(routes: Routes = []): HttpTestingController {
  localStorage.setItem('language', 'fr');
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideI18n({ en, fr }),
    ],
  });
  return TestBed.inject(HttpTestingController);
}

/** Answers the session check made at startup. */
export function flushMe(http: HttpTestingController, user: User | null): void {
  const req = http.expectOne('/api/auth/me');
  if (user) req.flush(user);
  else req.flush(null, { status: 401, statusText: 'Unauthorized' });
}

export const settle = () => new Promise((resolve) => setTimeout(resolve));
