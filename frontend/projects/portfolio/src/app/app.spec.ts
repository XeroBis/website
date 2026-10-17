import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { App } from './app';
import { ADMIN, USER, flushMe, setup } from './testing';

describe('App', () => {
  let http: HttpTestingController;

  beforeEach(() => (http = setup()));

  async function render(user: typeof USER | null) {
    const fixture = TestBed.createComponent(App);
    flushMe(http, user);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the header and the contact links', async () => {
    const el = await render(null);
    expect(el.querySelector('ab-header .title')?.textContent).toBe('Alan Bignon');
    const links = [...el.querySelectorAll('.site-footer a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['https://github.com/XeroBis', 'https://www.linkedin.com/in/alan-bignon/']);
  });

  it('shows the new-project link to admins only', async () => {
    expect((await render(USER)).querySelector('[data-testid="new-project"]')).toBeNull();
  });

  it('shows the new-project link to an admin', async () => {
    const link = (await render(ADMIN)).querySelector('[data-testid="new-project"]');
    expect(link?.getAttribute('href')).toBe('/admin/projects/new');
  });
});
