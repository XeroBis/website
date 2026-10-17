import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { CSRF_COOKIE, CSRF_HEADER } from './cookies';
import { TEST_USER, clearCookie, setCookie } from './testing';

describe('authInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => {
    backend.verify();
    clearCookie(CSRF_COOKIE);
  });

  const unauthorized = { status: 401, statusText: 'Unauthorized' };

  describe('CSRF header', () => {
    it('is added to unsafe /api calls from the csrf cookie', () => {
      setCookie(CSRF_COOKIE, 'tok');
      http.post('/api/cards/decks', {}).subscribe();
      http.patch('/api/auth/me', {}).subscribe();
      for (const req of backend.match(() => true)) {
        expect(req.request.headers.get(CSRF_HEADER)).toBe('tok');
        req.flush({});
      }
    });

    it('is not added to safe methods', () => {
      setCookie(CSRF_COOKIE, 'tok');
      http.get('/api/auth/me').subscribe();
      expect(backend.expectOne('/api/auth/me').request.headers.has(CSRF_HEADER)).toBe(false);
    });

    it('is not added without a csrf cookie', () => {
      http.post('/api/cards/decks', {}).subscribe();
      expect(backend.expectOne('/api/cards/decks').request.headers.has(CSRF_HEADER)).toBe(false);
    });

    it('is never sent outside /api', () => {
      setCookie(CSRF_COOKIE, 'tok');
      http.post('https://example.com/hook', {}).subscribe();
      expect(backend.expectOne('https://example.com/hook').request.headers.has(CSRF_HEADER)).toBe(
        false,
      );
    });
  });

  describe('refresh on 401', () => {
    it('refreshes once and retries with the new CSRF token', async () => {
      setCookie(CSRF_COOKIE, 'old');
      const result = firstValueFrom(http.post<{ ok: boolean }>('/api/cards/decks', {}));

      backend.expectOne('/api/cards/decks').flush(null, unauthorized);
      const refresh = backend.expectOne('/api/auth/refresh');
      expect(refresh.request.method).toBe('POST');
      expect(refresh.request.headers.get(CSRF_HEADER)).toBe('old');
      setCookie(CSRF_COOKIE, 'new'); // what the refresh response's Set-Cookie does
      refresh.flush(null, { status: 204, statusText: 'No Content' });

      const retry = backend.expectOne('/api/cards/decks');
      expect(retry.request.headers.get(CSRF_HEADER)).toBe('new');
      retry.flush({ ok: true });
      expect(await result).toEqual({ ok: true });
    });

    it('shares one refresh between concurrent 401s', () => {
      setCookie(CSRF_COOKIE, 'tok');
      http.get('/api/a').subscribe();
      http.get('/api/b').subscribe();
      backend.expectOne('/api/a').flush(null, unauthorized);
      backend.expectOne('/api/b').flush(null, unauthorized);
      backend.expectOne('/api/auth/refresh').flush(null);
      backend.expectOne('/api/a').flush({});
      backend.expectOne('/api/b').flush({});
    });

    it('clears the user and passes the 401 on when the refresh fails', async () => {
      setCookie(CSRF_COOKIE, 'tok');
      const loaded = auth.load();
      backend.expectOne('/api/auth/me').flush(TEST_USER);
      await loaded;
      expect(auth.user()).toEqual(TEST_USER);

      const result = firstValueFrom(http.get('/api/cards/decks'));
      backend.expectOne('/api/cards/decks').flush(null, unauthorized);
      backend.expectOne('/api/auth/refresh').flush(null, unauthorized);

      const err = await result.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpErrorResponse);
      expect((err as HttpErrorResponse).url).toContain('/api/cards/decks');
      expect(auth.user()).toBeNull();
    });

    it('does not refresh without a csrf cookie (no refresh token either)', async () => {
      const result = firstValueFrom(http.get('/api/auth/me'));
      backend.expectOne('/api/auth/me').flush(null, unauthorized);
      await expect(result).rejects.toBeInstanceOf(HttpErrorResponse);
      backend.expectNone('/api/auth/refresh');
    });

    it.each(['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout'])(
      'does not refresh after a 401 from %s',
      async (url) => {
        setCookie(CSRF_COOKIE, 'tok');
        const result = firstValueFrom(http.post(url, {}));
        backend.expectOne(url).flush(null, unauthorized);
        await expect(result).rejects.toBeInstanceOf(HttpErrorResponse);
        backend.expectNone('/api/auth/refresh');
      },
    );

    it('passes other errors through untouched', async () => {
      setCookie(CSRF_COOKIE, 'tok');
      const result = firstValueFrom(http.get('/api/cards/decks'));
      backend.expectOne('/api/cards/decks').flush(null, { status: 403, statusText: 'Forbidden' });
      await expect(result).rejects.toMatchObject({ status: 403 });
      backend.expectNone('/api/auth/refresh');
    });
  });
});
