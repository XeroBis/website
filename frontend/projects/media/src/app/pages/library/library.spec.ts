import { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { EntrySummary } from '../../media/models';
import { FILM, SERIES, entry, flushMe, settle, setup, switchToEnglish } from '../../testing';
import { Library } from './library';

const ENTRIES: EntrySummary[] = [
  entry({ id: 1, status: 'done', rating: 7, owned_formats: ['bluray'] }),
  entry({
    id: 2,
    item: SERIES,
    status: 'in_progress',
    current_season: 2,
    current_episode: 3,
    progress: { watched: 12, total: 19 },
  }),
];

describe('Library', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    http = setup([{ path: 'library', component: Library }]);
    harness = await RouterTestingHarness.create();
    flushMe(http);
  });
  afterEach(() => http.verify());

  const libraryRequest = (): TestRequest => http.expectOne((r) => r.url === '/api/media/library');

  async function open(
    url = '/library',
    entries = ENTRIES,
  ): Promise<{ el: HTMLElement; params: URLSearchParams }> {
    const navigation = harness.navigateByUrl(url);
    await settle();
    const req = libraryRequest();
    const params = new URLSearchParams(req.request.params.toString());
    req.flush(entries);
    http.expectOne('/api/media/library/genres').flush(['Action', 'Drama']);
    await navigation;
    await harness.fixture.whenStable();
    return { el: harness.routeNativeElement as HTMLElement, params };
  }

  const cells = (el: HTMLElement) =>
    [...el.querySelectorAll('[data-testid="entry"]')] as HTMLElement[];

  it('shows each entry with its title in the current language, status and rating', async () => {
    const { el, params } = await open();
    expect(params.toString()).toBe('sort=added');
    expect(cells(el).map((c) => c.querySelector('.poster strong')?.textContent)).toEqual([
      'Matrix',
      'Severance',
    ]);
    expect(cells(el)[0].querySelector('.status')?.textContent).toBe('Vu');
    expect(cells(el)[0].querySelector('.rating')?.textContent?.trim()).toBe('3,5');
    expect(cells(el)[0].querySelector('.owned')).not.toBeNull();
    expect(cells(el)[1].querySelector('.status')?.textContent).toBe('S2 · E3');
    expect(cells(el)[1].querySelector('.owned')).toBeNull();
    expect(el.querySelector('.count')?.textContent?.trim()).toBe('2 éléments');
    expect(cells(el)[0].querySelector('a.poster')?.getAttribute('href')).toBe('/library/1');
    expect(cells(el)[0].querySelector('a.poster img')?.getAttribute('src')).toBe(
      `/api/media/items/${FILM.id}/cover`,
    );

    await switchToEnglish(http);
    await harness.fixture.whenStable();
    expect(cells(el)[0].querySelector('.poster strong')?.textContent).toBe('The Matrix');
  });

  it('sends the filters from the URL and offers the library genres', async () => {
    const { el, params } = await open(
      '/library?type=book&status=done&owned=true&genre=Drama&q=dune&sort=title',
    );
    expect(Object.fromEntries(params)).toEqual({
      type: 'book',
      status: 'done',
      owned: 'true',
      genre: 'Drama',
      q: 'dune',
      sort: 'title',
    });
    expect(el.querySelector('.chip.on')?.textContent?.trim()).toBe('Livres');
    const genres = [...el.querySelectorAll('select')][2];
    expect([...genres.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Tous les genres',
      'Action',
      'Drama',
    ]);
  });

  it('puts a type chip in the URL', async () => {
    const { el } = await open();
    const chip = [...el.querySelectorAll('.types .chip')].find((c) =>
      c.textContent?.includes('Films'),
    ) as HTMLElement;
    chip.click();
    await settle();
    libraryRequest().flush([]);
    await settle();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/library?type=film');
    expect(el.querySelector('.empty a')?.getAttribute('href')).toBe('/add');
  });

  it('runs a quick action and reloads', async () => {
    const { el } = await open('/library', [entry({ id: 5 })]);
    const button = cells(el)[0].querySelector('ab-quick-actions button') as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe('Commencer');
    button.click();
    http
      .expectOne({ method: 'POST', url: '/api/media/library/5/start' })
      .flush(entry({ id: 5, status: 'in_progress' }));
    await settle();
    await settle();
    libraryRequest().flush([entry({ id: 5, status: 'in_progress' })]);
    await settle();
    await harness.fixture.whenStable();
    expect(cells(el)[0].querySelector('.status')?.textContent).toBe('En cours');
  });
});
