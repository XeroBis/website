import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { SearchResult } from '../../media/models';
import { BOOK, entry, flushMe, settle, setup } from '../../testing';
import { Add } from './add';

const RESULTS: SearchResult[] = [
  {
    source: 'tmdb',
    external_id: '603',
    type: 'film',
    title: 'Matrix',
    year: 1999,
    creators: 'Lana Wachowski',
    thumb_url: 'https://image.tmdb.org/t/p/w154/p.jpg',
    library_entry_id: null,
    library_status: null,
    library_owned: null,
    library_series_id: null,
  },
  {
    source: 'tmdb',
    external_id: '604',
    type: 'film',
    title: 'Matrix Reloaded',
    year: null,
    creators: null,
    thumb_url: null,
    library_entry_id: 42,
    library_status: 'done',
    library_owned: false,
    library_series_id: null,
  },
];

describe('Add', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<Add>;
  let el: HTMLElement;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    http = setup();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(Add);
    flushMe(http);
    await fixture.whenStable();
    el = fixture.nativeElement;
  });
  afterEach(() => http.verify());

  function type(selector: string, value: string) {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  const button = (text: string) =>
    [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === text,
    ) as HTMLButtonElement;

  async function search(kind: string, q: string, results: SearchResult[] = RESULTS) {
    button(kind).click();
    type('input[name="q"]', q);
    await fixture.whenStable();
    (el.querySelector('form.search button[type="submit"]') as HTMLButtonElement).click();
    const req = http.expectOne((r) => r.url === '/api/media/search');
    expect(req.request.params.get('type')).toBe(
      kind === 'Livre' ? 'book' : kind === 'Film' ? 'film' : 'series',
    );
    expect(req.request.params.get('q')).toBe(q.trim());
    // Books are searched in the UI's language by default; films and series have no `lang`.
    expect(req.request.params.get('lang')).toBe(kind === 'Livre' ? 'fr' : null);
    req.flush(results);
    await fixture.whenStable();
  }

  it('says which source it searches', async () => {
    expect(el.querySelector('.source')?.textContent?.trim()).toBe('Recherche dans Google Books.');
    button('Film').click();
    await fixture.whenStable();
    expect(el.querySelector('.source')?.textContent?.trim()).toBe('Recherche dans TMDB.');
  });

  it('adds a search result with the chosen status, then opens it', async () => {
    await search('Film', ' matrix ');
    const items = [...el.querySelectorAll('.results li')];
    expect(items.map((li) => li.querySelector('strong')?.textContent)).toEqual([
      'Matrix',
      'Matrix Reloaded',
    ]);
    expect(items[0].querySelector('img')?.getAttribute('src')).toBe(RESULTS[0].thumb_url);
    expect(items[1].querySelector('.pill')?.textContent).toContain('Déjà dans la bibliothèque');

    (items[0].querySelector('.result') as HTMLButtonElement).click();
    await fixture.whenStable();
    button("Vu aujourd'hui").click();
    await fixture.whenStable();
    // Films can't be owned.
    expect(button("Je l'ai")).toBeUndefined();
    button('Ajouter à la bibliothèque').click();

    const req = http.expectOne({ method: 'POST', url: '/api/media/library/from-search' });
    expect(req.request.body).toEqual({
      source: 'tmdb',
      external_id: '603',
      type: 'film',
      status: 'done',
      undated: false,
      owned: false,
    });
    req.flush(entry({ id: 9 }));
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/entries', 9]);
  });

  it('opens the entry of a result already in the library', async () => {
    await search('Film', 'matrix');
    (el.querySelectorAll('.results .result')[1] as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/entries', 42]);
  });

  it('shows a source failure', async () => {
    button('Série').click();
    type('input[name="q"]', 'x');
    await fixture.whenStable();
    (el.querySelector('form.search button[type="submit"]') as HTMLButtonElement).click();
    http
      .expectOne((r) => r.url === '/api/media/search')
      .flush({ detail: 'TMDB request failed' }, { status: 502, statusText: 'Bad Gateway' });
    await fixture.whenStable();
    expect(el.querySelector('.error')?.textContent).toBe('TMDB request failed');
  });

  it('adds by hand, pre-filled with the search text', async () => {
    await search('Livre', 'Mon livre', []);
    expect(el.textContent).toContain('Aucun résultat.');
    button("L'ajouter à la main").click();
    await fixture.whenStable();
    expect((el.querySelector('input[name="title"]') as HTMLInputElement).value).toBe('Mon livre');
    type('input[name="creators"]', ' Moi ');
    type('input[name="year"]', '2020');
    type('input[name="genres"]', 'Essai, , Histoire');
    button("Je l'ai").click();
    await fixture.whenStable();
    (el.querySelector('form.manual button[type="submit"]') as HTMLButtonElement).click();

    const req = http.expectOne({ method: 'POST', url: '/api/media/library/manual' });
    expect(req.request.body).toEqual({
      type: 'book',
      title: 'Mon livre',
      creators: 'Moi',
      year: 2020,
      genres: ['Essai', 'Histoire'],
      status: 'want',
      undated: false,
      owned: true,
    });
    req.flush(entry({ id: 11 }));
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/entries', 11]);
  });

  it('adds a result in one tap, then combines Read and Owned on it', async () => {
    const book: SearchResult = {
      ...RESULTS[0],
      source: 'googlebooks',
      type: 'book',
      external_id: 'vol1',
    };
    await search('Livre', 'one piece', [book]);
    const row = el.querySelector('[data-testid="result"]') as HTMLElement;
    const labels = () =>
      [...row.querySelectorAll('.quick button')].map((b) => b.textContent?.trim());
    expect(labels()).toEqual(['À lire', 'Lu', 'Possédé']);

    (row.querySelector('[data-quick="read"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(row.querySelector('.quick .muted')?.textContent?.trim()).toBe('Enregistrement…');
    const add = http.expectOne({ method: 'POST', url: '/api/media/library/from-search' });
    expect(add.request.body).toEqual({
      source: 'googlebooks',
      external_id: 'vol1',
      type: 'book',
      status: 'done',
      undated: true,
      owned: false,
    });
    add.flush(entry({ id: 12, item: BOOK, status: 'done' }));
    await settle();
    await fixture.whenStable();
    expect(navigate).not.toHaveBeenCalled();
    // Still on the row: Read is on, Owned can be added to the same entry.
    expect(labels()).toEqual(['Lu', 'Possédé']);
    expect(row.querySelector('[data-quick="read"]')?.classList).toContain('on');
    expect(row.querySelector('.pill')?.textContent).toContain('Déjà dans la bibliothèque');

    (row.querySelector('[data-quick="owned"]') as HTMLButtonElement).click();
    const patch = http.expectOne({ method: 'PATCH', url: '/api/media/library/12' });
    expect(patch.request.body).toEqual({ owned: true });
    patch.flush(entry({ id: 12, item: BOOK, status: 'done', owned: true }));
    await settle();
    await fixture.whenStable();
    expect(row.querySelector('[data-quick="owned"]')?.classList).toContain('on');
  });

  it('marks an owned result read afterwards', async () => {
    const book: SearchResult = {
      ...RESULTS[0],
      source: 'googlebooks',
      type: 'book',
      external_id: 'vol1',
      library_entry_id: 12,
      library_status: 'want',
      library_owned: true,
    };
    await search('Livre', 'one piece', [book]);
    const row = el.querySelector('[data-testid="result"]') as HTMLElement;
    expect(row.querySelector('[data-quick="owned"]')?.classList).toContain('on');
    (row.querySelector('[data-quick="read"]') as HTMLButtonElement).click();
    const finish = http.expectOne((r) => r.url === '/api/media/library/12/finish');
    expect(finish.request.params.get('undated')).toBe('true');
    finish.flush(entry({ id: 12, item: BOOK, status: 'done', owned: true }));
    await settle();
    await fixture.whenStable();
    expect(row.querySelector('[data-quick="read"]')?.classList).toContain('on');
    expect((row.querySelector('[data-quick="read"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers film quick adds and shows a failed one on its row', async () => {
    await search('Film', 'matrix');
    const row = el.querySelector('[data-testid="result"]') as HTMLElement;
    expect([...row.querySelectorAll('.quick button')].map((b) => b.textContent?.trim())).toEqual([
      'À voir',
      'Vu',
    ]);
    // A result already watched shows it.
    const watched = el.querySelectorAll('[data-testid="result"]')[1];
    expect(watched.querySelector('[data-quick="read"]')?.classList).toContain('on');
    (row.querySelector('[data-quick="read"]') as HTMLButtonElement).click();
    http
      .expectOne({ method: 'POST', url: '/api/media/library/from-search' })
      .flush({ detail: 'TMDB request failed' }, { status: 502, statusText: 'Bad Gateway' });
    await settle();
    await fixture.whenStable();
    expect(row.querySelector('.error')?.textContent).toBe('TMDB request failed');
  });

  it('loads more book results', async () => {
    const page = (n: number): SearchResult[] =>
      Array.from({ length: 20 }, (_, i) => ({
        ...RESULTS[0],
        source: 'googlebooks',
        type: 'book',
        external_id: `vol${n * 100 + i}`,
      }));
    await search('Livre', 'one piece', page(1));
    button('Plus de résultats').click();
    const req = http.expectOne((r) => r.url === '/api/media/search');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('lang')).toBe('fr');
    req.flush(page(2).slice(0, 5));
    await settle();
    await fixture.whenStable();
    expect(el.querySelectorAll('[data-testid="result"]').length).toBe(25);
    expect(button('Plus de résultats')).toBeUndefined();
  });

  it('searches books in the picked edition language', async () => {
    expect(button('FR')?.getAttribute('aria-pressed')).toBe('true');
    await search('Livre', 'piranesi');
    button('EN').click();
    await fixture.whenStable();
    expect(button('EN')?.getAttribute('aria-pressed')).toBe('true');
    // The shown results are re-searched in English.
    const req = http.expectOne((r) => r.url === '/api/media/search');
    expect(req.request.params.get('lang')).toBe('en');
    expect(req.request.params.get('q')).toBe('piranesi');
    req.flush([]);
    await fixture.whenStable();
    button('Film').click();
    await fixture.whenStable();
    http.expectOne((r) => r.url === '/api/media/search').flush([]);
    expect(button('EN')).toBeUndefined();
  });

  it('presets the type from the URL and links back to its shelf', async () => {
    TestBed.resetTestingModule();
    http = setup([{ path: 'add', component: Add }]);
    const harness = await RouterTestingHarness.create();
    flushMe(http);
    const page = (await harness.navigateByUrl('/add?type=series')) as unknown;
    expect(page).toBeInstanceOf(Add);
    await harness.fixture.whenStable();
    const root = harness.routeNativeElement as HTMLElement;
    expect(root.querySelector('.types .chip.on')?.textContent?.trim()).toBe('Série');
    expect(root.querySelector('.back a')?.getAttribute('href')).toBe('/videos');
  });
});

describe('Add volumes to a series', () => {
  let http: HttpTestingController;
  let root: HTMLElement;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    http = setup([{ path: 'add', component: Add }]);
    harness = await RouterTestingHarness.create();
    flushMe(http);
    const navigation = harness.navigateByUrl('/add?series=4');
    await settle();
    http.expectOne('/api/media/series/4').flush({
      id: 4,
      name: 'One Piece',
      volumes: 1,
      read: 0,
      owned: 0,
      cover_item: null,
      entries: [entry({ id: 1, series_id: 4, series_volume: 3 })],
    });
    const library = http.expectOne((r) => r.url === '/api/media/library');
    expect(library.request.params.toString()).toBe('shelf=books&sort=title');
    library.flush([
      entry({ id: 1, series_id: 4, series_volume: 3 }),
      entry({ id: 20, item: { ...BOOK, id: 60, title: 'One Piece, tome 5' } }),
      entry({ id: 21, item: { ...BOOK, id: 61, title: 'Dune', creators: 'Frank Herbert' } }),
    ]);
    await navigation;
    await harness.fixture.whenStable();
    root = harness.routeNativeElement as HTMLElement;
  });
  afterEach(() => http.verify());

  it('numbers volumes from the title, else after the highest', async () => {
    expect(root.querySelector('.series-note')?.textContent?.trim()).toBe(
      'Ajout de tomes à One Piece',
    );
    expect(root.querySelector('.types')).toBeNull();
    expect(root.querySelector('.back a')?.getAttribute('href')).toBe('/series/4');

    const input = root.querySelector('input[name="q"]') as HTMLInputElement;
    input.value = 'one piece';
    input.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();
    (root.querySelector('form.search button[type="submit"]') as HTMLButtonElement).click();
    const book = (id: string, title: string): SearchResult => ({
      ...RESULTS[0],
      source: 'googlebooks',
      type: 'book',
      external_id: id,
      title,
    });
    http
      .expectOne((r) => r.url === '/api/media/search')
      .flush([book('vol1', 'One Piece, Vol. 12: The Legend Begins'), book('vol2', 'Romance Dawn')]);
    await settle();
    await harness.fixture.whenStable();

    const rows = [...root.querySelectorAll('[data-testid="result"]')];
    (rows[0].querySelector('[data-quick="read"]') as HTMLButtonElement).click();
    (rows[1].querySelector('[data-quick="want"]') as HTMLButtonElement).click();
    const [first, second] = http.match({ method: 'POST', url: '/api/media/library/from-search' });
    expect(first.request.body).toMatchObject({ series_id: 4, series_volume: 12, undated: true });
    // No number in the title: after the highest so far (12, given above).
    expect(second.request.body).toMatchObject({ series_id: 4, series_volume: 13, status: 'want' });
    first.flush(entry({ id: 30 }));
    second.flush(entry({ id: 31 }));
    await settle();
  });

  it('files books already in the library under the series', async () => {
    const loose = () => [...root.querySelectorAll('[data-testid="loose"]')] as HTMLElement[];
    // Only books in no series.
    expect(loose().map((li) => li.querySelector('strong')?.textContent)).toEqual([
      'One Piece, tome 5',
      'Dune',
    ]);
    const filter = root.querySelector('input[name="looseFilter"]') as HTMLInputElement;
    filter.value = 'DUNE';
    filter.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();
    expect(loose().map((li) => li.querySelector('strong')?.textContent)).toEqual(['Dune']);
    filter.value = '';
    filter.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();

    (loose()[0].querySelector('button') as HTMLButtonElement).click();
    const patch = http.expectOne({ method: 'PATCH', url: '/api/media/library/20' });
    expect(patch.request.body).toEqual({ series_id: 4, series_volume: 5 });
    patch.flush(entry({ id: 20, series_id: 4, series_volume: 5 }));
    await settle();
    await harness.fixture.whenStable();
    expect(loose().map((li) => li.querySelector('strong')?.textContent)).toEqual(['Dune']);
  });

  it('files a search result already in the library under the series', async () => {
    const input = root.querySelector('input[name="q"]') as HTMLInputElement;
    input.value = 'dune';
    input.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();
    (root.querySelector('form.search button[type="submit"]') as HTMLButtonElement).click();
    const inLibrary: SearchResult = {
      ...RESULTS[1],
      source: 'googlebooks',
      type: 'book',
      title: 'Dune',
      library_entry_id: 21,
    };
    http.expectOne((r) => r.url === '/api/media/search').flush([inLibrary]);
    await settle();
    await harness.fixture.whenStable();

    const row = root.querySelector('[data-testid="result"]') as HTMLElement;
    (row.querySelector('[data-quick="file"]') as HTMLButtonElement).click();
    const patch = http.expectOne({ method: 'PATCH', url: '/api/media/library/21' });
    // No number in the title: after the series' highest (3).
    expect(patch.request.body).toEqual({ series_id: 4, series_volume: 4 });
    patch.flush(entry({ id: 21, series_id: 4, series_volume: 4 }));
    await settle();
    await harness.fixture.whenStable();
    expect(row.querySelector('[data-quick="file"]')).toBeNull();
    expect(row.querySelector('.in-series')?.textContent?.trim()).toBe('Dans la série');
    expect(root.querySelectorAll('[data-testid="loose"]').length).toBe(1);
  });
});
