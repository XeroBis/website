import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

import { ENVIRONMENT } from '../environment/environment.token';
import { AuthService } from './auth.service';
import { BrowserLocation } from './browser-location';
import { GrantableApp } from './user';

/**
 * Returns a function sending a logged-out user to the portfolio's home page:
 * a router navigation inside the portfolio, a full-page one from any other
 * app. Everything is injected up front, since guards call it after an
 * `await`.
 */
function injectLoggedOutRedirect(): () => UrlTree | false {
  const router = inject(Router);
  const location = inject(BrowserLocation);
  const portfolioOrigin = inject(ENVIRONMENT).appUrls.portfolio;

  return () => {
    if (location.origin === portfolioOrigin) return router.parseUrl('/');
    location.assign(`${portfolioOrigin}/`);
    return false;
  };
}

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const loggedOutRedirect = injectLoggedOutRedirect();
  return (await auth.load()) ? true : loggedOutRedirect();
};

/** Logged out → portfolio; logged in but not admin → the app's root. */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const loggedOutRedirect = injectLoggedOutRedirect();
  const user = await auth.load();
  if (!user) return loggedOutRedirect();
  return user.is_admin ? true : router.parseUrl('/');
};

/**
 * Logged out → portfolio; logged in without access to `app` → the auth
 * app's account page, which lists the apps the user can open.
 */
export function appGuard(app: GrantableApp): CanActivateFn {
  return async () => {
    const auth = inject(AuthService);
    const location = inject(BrowserLocation);
    const authOrigin = inject(ENVIRONMENT).appUrls.auth;
    const loggedOutRedirect = injectLoggedOutRedirect();
    const user = await auth.load();
    if (!user) return loggedOutRedirect();
    if (user.apps.includes(app)) return true;
    location.assign(`${authOrigin}/`);
    return false;
  };
}
