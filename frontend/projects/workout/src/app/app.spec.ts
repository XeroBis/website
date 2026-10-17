import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideI18n } from '@shared';

import en from '../i18n/en.json';
import fr from '../i18n/fr.json';
import { App } from './app';

describe('App', () => {
  it('shows the header with the workout links', async () => {
    localStorage.setItem('language', 'en');
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideI18n({ en, fr })],
    });
    const fixture = TestBed.createComponent(App);
    TestBed.inject(HttpTestingController).expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('ab-header .links a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/dashboard', '/workouts', '/templates', '/circuits', '/exercises', '/equipments', '/data',
    ]);
  });
});
