import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { BrowserLocation, ENVIRONMENT } from '@shared';

import { routes } from './app.routes';
import { USER, flushMe, setup } from './testing';

describe('routes', () => {
  let http: HttpTestingController;
  let assign: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    assign = vi.fn();
    http = setup(routes, [
      {
        provide: BrowserLocation,
        useValue: { origin: 'http://localhost:4603', href: 'http://localhost:4603/', assign },
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
            auth: 'http://localhost:4604',
          },
        },
      },
    ]);
  });

  function go(url: string) {
    const router = TestBed.inject(Router);
    const done = router.navigateByUrl(url);
    return { router, done };
  }

  it('sends a logged-out visitor to the portfolio', async () => {
    const { done } = go('/library');
    flushMe(http, null);
    expect(await done).toBe(false);
    expect(assign).toHaveBeenCalledWith('http://localhost:4600/');
  });

  it('sends a user without media to the account page', async () => {
    const { done } = go('/library');
    flushMe(http, { ...USER, apps: ['cards'] });
    expect(await done).toBe(false);
    expect(assign).toHaveBeenCalledWith('http://localhost:4604/');
  });

  it('redirects / and unknown paths to the library', async () => {
    const { router, done } = go('/');
    flushMe(http);
    await done;
    expect(router.url).toBe('/library');
    await router.navigateByUrl('/nope');
    expect(router.url).toBe('/library');
  });
});
