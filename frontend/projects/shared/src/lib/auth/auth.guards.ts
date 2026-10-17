import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

import { ENVIRONMENT } from '../environment/environment.token';
import { AuthService } from './auth.service';
import { BrowserLocation } from './browser-location';
import { GrantableApp } from './user';

/**
 * Returns a function sending a logged-out user to the auth app's login page,
 * with a `?redirect=` back to the page they wanted: a router navigation
 * inside the auth app, a full-page one from any other app. Everything is
 * injected up front, since guards call it after an `await`.
 */
function injectLoginRedirect(): (targetUrl: string) => UrlTree | false {
  const router = inject(Router);
  const location = inject(BrowserLocation);
  const auth = inject(AuthService);
  const authOrigin = inject(ENVIRONMENT).appUrls.auth;

  return (targetUrl) => {
    const returnTo = new URL(targetUrl, location.origin).href;
    if (location.origin === authOrigin) {
      return router.createUrlTree(['/login'], { queryParams: { redirect: returnTo } });
    }
    location.assign(auth.loginUrl(returnTo));
    return false;
  };
}

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const loginRedirect = injectLoginRedirect();
  return (await auth.load()) ? true : loginRedirect(state.url);
};

/** Logged out → login page; logged in but not admin → the app's root. */
export const adminGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const loginRedirect = injectLoginRedirect();
  const user = await auth.load();
  if (!user) return loginRedirect(state.url);
  return user.is_admin ? true : router.parseUrl('/');
};

/**
 * Logged out → login page; logged in without access to `app` → the auth
 * app's account page, which lists the apps the user can open.
 */
export function appGuard(app: GrantableApp): CanActivateFn {
  return async (_route, state) => {
    const auth = inject(AuthService);
    const location = inject(BrowserLocation);
    const authOrigin = inject(ENVIRONMENT).appUrls.auth;
    const loginRedirect = injectLoginRedirect();
    const user = await auth.load();
    if (!user) return loginRedirect(state.url);
    if (user.apps.includes(app)) return true;
    location.assign(`${authOrigin}/`);
    return false;
  };
}
