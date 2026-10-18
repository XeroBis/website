import { registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import localeFr from '@angular/common/locales/fr';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Routes, provideRouter, withComponentInputBinding } from '@angular/router';

import { LanguageService, User, provideI18n } from '@shared';

import en from '../i18n/en.json';
import fr from '../i18n/fr.json';
import { EntryDetail, MediaItem } from './media/models';

// Spec helpers.

// As in app.config.ts, for DatePipe / DecimalPipe in French.
registerLocaleData(localeFr);

export const USER: User = {
  id: 1,
  email: 'user@example.com',
  pseudo: 'Testy',
  language: 'fr',
  theme: 'system',
  is_admin: false,
  apps: ['media'],
};

export const FILM: MediaItem = {
  id: 7,
  type: 'film',
  title: 'The Matrix',
  title_fr: 'Matrix',
  original_title: null,
  year: 1999,
  creators: 'Lana Wachowski, Lilly Wachowski',
  genres: ['Action', 'Science-Fiction'],
  synopsis: 'Neo.',
  synopsis_fr: 'Néo.',
  runtime_minutes: 136,
  isbn: null,
  season_episode_counts: null,
  source: 'tmdb',
  external_id: '603',
  has_cover: true,
};

export const SERIES: MediaItem = {
  ...FILM,
  id: 8,
  type: 'series',
  title: 'Severance',
  title_fr: null,
  creators: 'Dan Erickson',
  runtime_minutes: null,
  season_episode_counts: [9, 10],
  external_id: '95396',
  has_cover: false,
};

export function entry(overrides: Partial<EntryDetail> = {}): EntryDetail {
  return {
    id: 3,
    status: 'want',
    rating: null,
    owned_formats: [],
    current_season: null,
    current_episode: null,
    added_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    last_finished_on: null,
    progress: null,
    at_last_known_episode: false,
    item: FILM,
    notes: null,
    sessions: [],
    ...overrides,
  };
}

/** The app's real providers, with a fake backend. Language starts as French. */
export function setup(routes: Routes = [], providers: Provider[] = []): HttpTestingController {
  localStorage.setItem('language', 'fr');
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideI18n({ en, fr }),
      ...providers,
    ],
  });
  return TestBed.inject(HttpTestingController);
}

/** Answers the session check made at startup. */
export function flushMe(http: HttpTestingController, user: User | null = USER): void {
  const req = http.expectOne('/api/auth/me');
  if (user) req.flush(user);
  else req.flush(null, { status: 401, statusText: 'Unauthorized' });
}

/** The header's switch: saved on the account, since the user's language wins. */
export async function switchToEnglish(http: HttpTestingController): Promise<void> {
  const change = TestBed.inject(LanguageService).change('en');
  http
    .expectOne({ method: 'PATCH', url: '/api/auth/me/language' })
    .flush({ ...USER, language: 'en' });
  await change;
}

export const settle = () => new Promise((resolve) => setTimeout(resolve));
