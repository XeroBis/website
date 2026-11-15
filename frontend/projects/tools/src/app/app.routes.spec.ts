import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { BrowserLocation, ENVIRONMENT } from '@shared';

import { routes } from './app.routes';
import { USER, flushMe, setup } from './testing';

describe('routes', () => {
  let assign: ReturnType<typeof vi.fn>;
  let http: ReturnType<typeof setup>['http'];

  beforeEach(() => {
    assign = vi.fn();
    ({ http } = setup(routes, [
      {
        provide: BrowserLocation,
        useValue: { origin: 'http://localhost:4605', href: 'http://localhost:4605/', assign },
      },
      {
        provide: ENVIRONMENT,
        useValue: {
          production: false,
          cookieDomain: null,
          appUrls: {
            portfolio: 'http://localhost:4600',
            workout: 'http://localhost:4601',
            cards: 'http://localhost:4602',
            media: 'http://localhost:4603',
            tools: 'http://localhost:4605',
            auth: 'http://localhost:4604',
          },
        },
      },
    ]));
  });
  afterEach(() => http.verify());

  function go(url: string) {
    const router = TestBed.inject(Router);
    return { router, done: router.navigateByUrl(url) };
  }

  it('sends a logged-out visitor to the portfolio', async () => {
    const { done } = go('/merge');
    flushMe(http, null);
    expect(await done).toBe(false);
    expect(assign).toHaveBeenCalledWith('http://localhost:4600/');
  });

  it('sends a user without tools to the account page', async () => {
    const { done } = go('/merge');
    flushMe(http, { ...USER, apps: ['media'] });
    expect(await done).toBe(false);
    expect(assign).toHaveBeenCalledWith('http://localhost:4604/');
  });

  it('opens each tool and sends unknown paths home', async () => {
    const { router, done } = go('/pdf-to-images');
    flushMe(http);
    expect(await done).toBe(true);
    await router.navigateByUrl('/nope');
    expect(router.url).toBe('/');
  });
});
