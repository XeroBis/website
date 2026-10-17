import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { App } from './app';
import { flushMe, setup } from './testing';

describe('App', () => {
  let http: HttpTestingController;

  beforeEach(() => (http = setup()));
  afterEach(() => http.verify());

  it('shows the header with the app links and the TMDB credit', async () => {
    const fixture = TestBed.createComponent(App);
    flushMe(http);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('ab-header .title')?.textContent).toBe('Media');
    const links = [...el.querySelectorAll('ab-header .links a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/library', '/add']);
    expect(links.map((a) => a.textContent?.trim())).toEqual(['Bibliothèque', 'Ajouter']);
    expect(el.querySelector('footer.credit')?.textContent).toContain(
      "n'est ni approuvé ni certifié par TMDB",
    );
    expect(el.querySelector('footer.credit a[href="https://www.themoviedb.org"]')).not.toBeNull();
  });
});
