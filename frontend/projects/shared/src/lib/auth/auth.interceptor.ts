import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';

import { AuthService } from './auth.service';
import { CSRF_COOKIE, CSRF_HEADER, readCookie } from './cookies';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
// A 401 from these means "wrong credentials" or "session gone", not
// "access token expired": refreshing wouldn't help.
const NO_REFRESH = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout'];

function withCsrf(req: HttpRequest<unknown>): HttpRequest<unknown> {
  const token = readCookie(CSRF_COOKIE);
  if (SAFE_METHODS.includes(req.method) || !token) return req;
  return req.clone({ setHeaders: { [CSRF_HEADER]: token } });
}

/**
 * For `/api/...` calls: adds the double-submit CSRF header on unsafe
 * methods, and on a 401 refreshes the session once and retries. If the
 * refresh fails too, the user is cleared and the original 401 is passed on.
 * No `csrf` cookie means no refresh token either (same lifetime), so no
 * refresh is attempted.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/')) return next(req);
  const auth = inject(AuthService);

  return next(withCsrf(req)).pipe(
    catchError((err: unknown) => {
      const retry =
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        !NO_REFRESH.includes(req.url) &&
        readCookie(CSRF_COOKIE) !== null;
      if (!retry) return throwError(() => err);
      return auth.refresh().pipe(
        catchError(() => {
          auth.clear();
          return throwError(() => err);
        }),
        // Re-read the cookie: the refresh issued a new CSRF token.
        switchMap(() => next(withCsrf(req))),
      );
    }),
  );
};
