import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { Placeholder } from './placeholder';

describe('Placeholder', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Placeholder],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  function render() {
    const fixture = TestBed.createComponent(Placeholder);
    fixture.componentRef.setInput('appName', 'Cards');
    fixture.detectChanges();
    return fixture;
  }

  const status = (el: HTMLElement) =>
    el.querySelector('[data-testid="backend-status"]')?.textContent;

  const anonymous = () =>
    http.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });

  it('shows ok when /api/health answers', async () => {
    const fixture = render();
    anonymous();
    http.expectOne('/api/health').flush({ status: 'ok' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h1').textContent).toBe('Cards');
    expect(status(fixture.nativeElement)).toBe('ok');
  });

  it('shows unreachable when /api/health fails', async () => {
    const fixture = render();
    anonymous();
    http.expectOne('/api/health').flush('down', { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(status(fixture.nativeElement)).toBe('unreachable');
  });

  const session = (el: HTMLElement) => el.querySelector('[data-testid="session"]')?.textContent;

  it('shows the logged-in user', async () => {
    const fixture = render();
    http.expectOne('/api/health').flush({ status: 'ok' });
    http.expectOne('/api/auth/me').flush({
      id: 1,
      email: 'user@example.com',
      pseudo: 'Testy',
      language: 'fr',
      theme: 'system',
      is_admin: false,
      apps: [],
    });
    await fixture.whenStable();
    expect(session(fixture.nativeElement)).toContain('Logged in as Testy');
  });

  it('offers a login link when logged out', async () => {
    const fixture = render();
    http.expectOne('/api/health').flush({ status: 'ok' });
    anonymous();
    await fixture.whenStable();
    expect(session(fixture.nativeElement)).toContain('Not logged in');
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toContain('/login?redirect=');
  });
});
