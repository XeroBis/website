import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';

import { ENVIRONMENT } from '../environment/environment.token';
import { adminGuard, authGuard } from './auth.guards';
import { BrowserLocation } from './browser-location';
import { TEST_ENV, TEST_USER } from './testing';

describe('auth guards', () => {
  let backend: HttpTestingController;
  let location: { origin: string; href: string; assign: ReturnType<typeof vi.fn> };

  function setup(origin: string) {
    location = { origin, href: `${origin}/decks/3`, assign: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: TEST_ENV },
        { provide: BrowserLocation, useValue: location },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
  }

  async function run(guard: CanActivateFn, me: object | null, url = '/decks/3?x=1') {
    const state = { url } as RouterStateSnapshot;
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, state),
    ) as Promise<boolean | UrlTree>;
    const req = backend.expectOne('/api/auth/me');
    if (me) req.flush(me);
    else req.flush(null, { status: 401, statusText: 'Unauthorized' });
    return result;
  }

  const serialize = (tree: unknown) => TestBed.inject(Router).serializeUrl(tree as UrlTree);

  describe('authGuard', () => {
    it('lets a logged-in user through', async () => {
      setup(TEST_ENV.appUrls.cards);
      expect(await run(authGuard, TEST_USER)).toBe(true);
      expect(location.assign).not.toHaveBeenCalled();
    });

    it('sends a logged-out user of another app to the auth login page', async () => {
      setup(TEST_ENV.appUrls.cards);
      expect(await run(authGuard, null)).toBe(false);
      expect(location.assign).toHaveBeenCalledWith(
        'http://localhost:4604/login?redirect=' +
          encodeURIComponent('http://localhost:4602/decks/3?x=1'),
      );
    });

    it('routes to /login inside the auth app itself', async () => {
      setup(TEST_ENV.appUrls.auth);
      const result = (await run(authGuard, null, '/')) as UrlTree;
      expect(result.root.children['primary'].segments.map(String)).toEqual(['login']);
      expect(result.queryParams).toEqual({ redirect: 'http://localhost:4604/' });
      expect(location.assign).not.toHaveBeenCalled();
    });
  });

  describe('adminGuard', () => {
    it('lets an admin through', async () => {
      setup(TEST_ENV.appUrls.portfolio);
      expect(await run(adminGuard, { ...TEST_USER, is_admin: true })).toBe(true);
    });

    it('sends a non-admin to the app root', async () => {
      setup(TEST_ENV.appUrls.portfolio);
      expect(serialize(await run(adminGuard, TEST_USER))).toBe('/');
    });

    it('sends a logged-out user to the login page', async () => {
      setup(TEST_ENV.appUrls.portfolio);
      expect(await run(adminGuard, null)).toBe(false);
      expect(location.assign).toHaveBeenCalledOnce();
    });
  });
});
