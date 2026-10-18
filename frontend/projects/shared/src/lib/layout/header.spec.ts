import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

import { BrowserLocation } from '../auth/browser-location';
import { TEST_ENV, TEST_USER } from '../auth/testing';
import { ENVIRONMENT } from '../environment/environment.token';
import { provideI18n } from '../i18n/i18n';
import { Header } from './header';

@Component({
  imports: [Header],
  template: `<ab-header title="T"><a href="/x">Extra</a></ab-header>`,
})
class Host {}

describe('Header', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.setItem('language', 'fr'); // jsdom's navigator is en-US
    TestBed.configureTestingModule({
      imports: [Header],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideI18n({ fr: {}, en: {} }),
        { provide: ENVIRONMENT, useValue: TEST_ENV },
        {
          provide: BrowserLocation,
          useValue: { origin: TEST_ENV.appUrls.portfolio, href: 'http://localhost:4600/?tag=x' },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(me: object | null) {
    const fixture = TestBed.createComponent(Header);
    fixture.componentRef.setInput('title', 'Alan Bignon');
    const req = http.expectOne('/api/auth/me');
    if (me) req.flush(me);
    else req.flush(null, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const button = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

  it('shows the title and a login link back to the current page when logged out', async () => {
    const el = await render(null);
    expect(el.querySelector('.title')?.textContent).toBe('Alan Bignon');
    const login = el.querySelector('a.login')!;
    expect(login.textContent?.trim()).toBe('Se connecter');
    expect(login.getAttribute('href')).toBe(
      'http://localhost:4604/login?redirect=' + encodeURIComponent('http://localhost:4600/?tag=x'),
    );
  });

  it('shows the pseudo and a link to the account page instead of logging out', async () => {
    const el = await render(TEST_USER);
    expect(el.querySelector('[data-testid="pseudo"]')?.textContent).toBe('Testy');
    const account = el.querySelector('a.account')!;
    expect(account.getAttribute('aria-label')).toBe('Mon compte');
    expect(account.querySelectorAll('svg rect')).toHaveLength(4);
    expect(account.getAttribute('href')).toBe('http://localhost:4604/');
    expect(el.querySelector('a.login')).toBeNull();
    expect(el.querySelector('.session button')).toBeNull();
  });

  it('switches language locally when logged out', async () => {
    const el = await render(null);
    button(el, 'EN').click();
    TestBed.tick();
    expect(TestBed.inject(TranslateService).getCurrentLang()).toBe('en');
    expect(localStorage.getItem('language')).toBe('en');
    expect(button(el, 'EN').getAttribute('aria-pressed')).toBe('true');
    http.expectNone('/api/auth/me/language');
  });

  it("saves the language on the user's account when logged in", async () => {
    const el = await render(TEST_USER);
    button(el, 'EN').click();
    const req = http.expectOne({ method: 'PATCH', url: '/api/auth/me/language' });
    expect(req.request.body).toEqual({ language: 'en' });
    req.flush({ ...TEST_USER, language: 'en' });
    await new Promise((r) => setTimeout(r));
    TestBed.tick();
    expect(TestBed.inject(TranslateService).getCurrentLang()).toBe('en');
  });

  it('opens and closes the phone menu, closing it when a link is tapped', async () => {
    const fixture = TestBed.createComponent(Host);
    http.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const toggle = el.querySelector<HTMLButtonElement>('button.menu-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('header')?.classList).toContain('open');
    el.querySelector<HTMLAnchorElement>('nav.links a')!.addEventListener('click', (e) => e.preventDefault());
    el.querySelector<HTMLAnchorElement>('nav.links a')!.click();
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await fixture.whenStable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it("projects the app's own links", async () => {
    const fixture = TestBed.createComponent(Host);
    http.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('nav.links a')?.textContent).toBe('Extra');
  });
});
