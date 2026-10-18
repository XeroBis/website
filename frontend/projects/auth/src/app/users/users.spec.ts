import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AdminUser, provideI18n } from '@shared';

import en from '../../i18n/en.json';
import fr from '../../i18n/fr.json';
import { Users } from './users';

const ADMIN: AdminUser = {
  id: 1,
  email: 'admin@example.com',
  pseudo: 'Boss',
  language: 'fr',
  theme: 'system',
  is_admin: true,
  apps: ['portfolio', 'workout', 'cards', 'media'],
  created_at: '2026-10-01T10:00:00Z',
};
const BOB: AdminUser = {
  ...ADMIN,
  id: 2,
  email: 'bob@example.com',
  pseudo: 'Bob',
  is_admin: false,
  apps: ['cards'],
  created_at: '2026-10-05T10:00:00Z',
};

describe('Users', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.setItem('language', 'en');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideI18n({ en, fr }),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  async function render() {
    const fixture = TestBed.createComponent(Users);
    http.expectOne('/api/auth/users').flush([ADMIN, BOB]);
    await fixture.whenStable();
    return fixture;
  }

  const row = (el: HTMLElement, id: number) => el.querySelector(`[data-testid="user-${id}"]`) as HTMLElement;
  const boxes = (row: HTMLElement) => [...row.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
  const flushLanguageCheck = () => http.match('/api/auth/me').forEach((r) => r.flush(null, { status: 401, statusText: '' }));

  it('lists every user, with checkboxes for non-admins only', async () => {
    const el = (await render()).nativeElement as HTMLElement;
    flushLanguageCheck();
    expect(row(el, 1).textContent).toContain('Admin: all apps');
    expect(boxes(row(el, 1))).toEqual([]);
    expect(row(el, 2).textContent).toContain('bob@example.com');
    expect(row(el, 2).textContent).toContain('Since 2026-10-05');
    expect(boxes(row(el, 2)).map((b) => b.checked)).toEqual([false, false, true, false]);
  });

  it('saves a toggled app at once', async () => {
    const fixture = await render();
    flushLanguageCheck();
    const workout = boxes(row(fixture.nativeElement, 2))[1];
    workout.click();
    const req = http.expectOne('/api/auth/users/2/apps');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ apps: ['cards', 'workout'] });
    req.flush({ ...BOB, apps: ['workout', 'cards'] });
    await fixture.whenStable();
    expect(boxes(row(fixture.nativeElement, 2)).map((b) => b.checked)).toEqual([false, true, true, false]);
  });

  it('reverts the checkbox and shows an error when saving fails', async () => {
    const fixture = await render();
    flushLanguageCheck();
    const cards = boxes(row(fixture.nativeElement, 2))[2];
    cards.click();
    const req = http.expectOne('/api/auth/users/2/apps');
    expect(req.request.body).toEqual({ apps: [] });
    req.flush(null, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    expect(cards.checked).toBe(true);
    expect(row(fixture.nativeElement, 2).querySelector('.error')?.textContent).toContain('Could not save access.');
  });
});
