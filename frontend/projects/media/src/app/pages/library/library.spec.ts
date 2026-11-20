import { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { BookSeries, EntrySummary } from '../../media/models';
import { BOOK, FILM, SERIES, entry, flushMe, settle, setup, switchToEnglish } from '../../testing';
import { Library } from './library';

const ENTRIES: EntrySummary[] = [
  entry({ id: 1, status: 'done', rating: 7 }),
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
    http = setup([
      { path: 'books', component: Library, data: { shelf: 'books' } },
      { path: 'videos', component: Library, data: { shelf: 'videos' } },
    ]);
    harness = await RouterTestingHarness.create();
    flushMe(http);
  });
  afterEach(() => http.verify());

  const libraryRequest = (): TestRequest => http.expectOne((r) => r.url === '/api/media/library');

  async function open(
    url = '/videos',
    entries = ENTRIES,
    series: BookSeries[] = [],
  ): Promise<{ el: HTMLElement; params: URLSearchParams }> {
    const navigation = harness.navigateByUrl(url);
    await settle();
    const req = libraryRequest();
    const params = new URLSearchParams(req.request.params.toString());
    req.flush(entries);
    if (url.startsWith('/books')) http.expectOne('/api/media/series').flush(series);
    const genres = http.expectOne((r) => r.url === '/api/media/library/genres');
    expect(genres.request.params.get('shelf')).toBe(url.startsWith('/books') ? 'books' : 'videos');
    genres.flush(['Action', 'Drama']);
    await navigation;
    await harness.fixture.whenStable();
    return { el: harness.routeNativeElement as HTMLElement, params };
  }

  const cells = (el: HTMLElement) =>
    [...el.querySelectorAll('[data-testid="entry"]')] as HTMLElement[];

  it('shows each entry with its title in the current language, status and rating', async () => {
    const { el, params } = await open();
    expect(params.toString()).toBe('shelf=videos&sort=added');
    expect(el.querySelector('h1')?.textContent).toBe('Vidéothèque');
    expect(cells(el).map((c) => c.querySelector('.poster strong')?.textContent)).toEqual([
      'Matrix',
      'Severance',
    ]);
    expect(cells(el)[0].querySelector('.status')?.textContent).toBe('Vu');
    expect(cells(el)[0].querySelector('.rating')?.textContent?.trim()).toBe('3,5');
    expect(cells(el)[0].querySelector('.owned')).toBeNull();
    expect(cells(el)[1].querySelector('.status')?.textContent).toBe('S2 · E3');
    expect(cells(el)[1].querySelector('.owned')).toBeNull();
    expect(el.querySelector('.count')?.textContent?.trim()).toBe('2 éléments');
    expect(cells(el)[0].querySelector('a.poster')?.getAttribute('href')).toBe('/entries/1');
    expect(cells(el)[0].querySelector('a.poster img')?.getAttribute('src')).toBe(
      `/api/media/items/${FILM.id}/cover?v=${Date.parse(FILM.updated_at)}`,
    );

    await switchToEnglish(http);
    await harness.fixture.whenStable();
    expect(cells(el)[0].querySelector('.poster strong')?.textContent).toBe('The Matrix');
  });

  it('shows books with ownership, no type chips and a book Add button', async () => {
    const { el, params } = await open(
      '/books?status=done&owned=true&genre=Drama&q=dune&sort=title',
      [entry({ id: 4, item: BOOK, status: 'done', owned: true })],
    );
    expect(Object.fromEntries(params)).toEqual({
      shelf: 'books',
      status: 'done',
      owned: 'true',
      genre: 'Drama',
      q: 'dune',
      sort: 'title',
    });
    expect(el.querySelector('h1')?.textContent).toBe('Bibliothèque');
    expect(el.querySelector('.types')).toBeNull();
    expect(cells(el)[0].querySelector('.status')?.textContent).toBe('Lu');
    expect(cells(el)[0].querySelector('.owned')).not.toBeNull();
    expect(el.querySelector('.head a.add')?.getAttribute('href')).toBe('/add?type=book');
    const genres = [...el.querySelectorAll('select')][2];
    expect([...genres.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Tous les genres',
      'Action',
      'Drama',
    ]);
  });

  it('has no ownership filter on the Vidéothèque and ignores one in the URL', async () => {
    const { el, params } = await open('/videos?owned=true&type=book');
    expect(Object.fromEntries(params)).toEqual({ shelf: 'videos', sort: 'added' });
    expect(el.querySelectorAll('select').length).toBe(3);
    expect(el.querySelector('.head a.add')?.getAttribute('href')).toBe('/add?type=film');
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
    expect(TestBed.inject(Router).url).toBe('/videos?type=film');
    expect(el.querySelector('.empty a')?.getAttribute('href')).toBe('/add?type=film');
  });

  it('runs a quick action and reloads', async () => {
    const { el } = await open('/videos', [entry({ id: 5 })]);
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

describe('Library series cards', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    http = setup([{ path: 'books', component: Library, data: { shelf: 'books' } }]);
    harness = await RouterTestingHarness.create();
    flushMe(http);
  });
  afterEach(() => http.verify());

  it('collapses the volumes of a series into one card', async () => {
    const vol = (id: number, volume: number) =>
      entry({
        id,
        item: { ...BOOK, id: 20 + id, title: `One Piece ${volume}` },
        series_id: 4,
        series_name: 'One Piece',
        series_volume: volume,
      });
    const navigation = harness.navigateByUrl('/books');
    await settle();
    http
      .expectOne((r) => r.url === '/api/media/library')
      .flush([vol(1, 2), entry({ id: 9, item: BOOK }), vol(2, 1)]);
    http.expectOne('/api/media/series').flush([
      {
        id: 4,
        name: 'One Piece',
        volumes: 100,
        read: 60,
        owned: 100,
        cover_item: { ...BOOK, id: 22, title: 'One Piece 1' },
      },
    ]);
    http.expectOne((r) => r.url === '/api/media/library/genres').flush([]);
    await navigation;
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement as HTMLElement;
    const cells = [...el.querySelectorAll('.grid > .cell')];
    expect(cells.map((c) => c.getAttribute('data-testid'))).toEqual(['series', 'entry']);
    expect(cells[0].querySelector('.poster strong')?.textContent).toBe('One Piece');
    expect(cells[0].querySelector('a.poster')?.getAttribute('href')).toBe('/series/4');
    expect(cells[0].querySelector('.status')?.textContent?.trim()).toBe('60 / 100 lus');
    expect(cells[0].querySelector('.owned')).not.toBeNull();
    expect(el.querySelector('.count')?.textContent?.trim()).toBe('2 éléments');
  });

  it('drops a book on another to make a series, and one on a series to join it', async () => {
    const book = (id: number, title: string, overrides = {}) =>
      entry({ id, item: { ...BOOK, id: 50 + id, title }, ...overrides });
    const naruto = [book(9, 'Naruto T1'), book(10, 'Naruto, tome 2'), book(11, 'Saga')];
    const navigation = harness.navigateByUrl('/books');
    await settle();
    http.expectOne((r) => r.url === '/api/media/library').flush(naruto);
    http.expectOne('/api/media/series').flush([]);
    http.expectOne((r) => r.url === '/api/media/library/genres').flush([]);
    await navigation;
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement as HTMLElement;
    const cells = () => [...el.querySelectorAll('.grid > .cell')] as HTMLElement[];
    const page = harness.routeDebugElement!.componentInstance as {
      dragStarted(e: EntrySummary): void;
      dragMoved(e: unknown): void;
      dragEnded(e: unknown): Promise<void>;
    };
    /** Drags `from` (an entry) and releases it over the cell `to`. */
    const dragOnto = async (from: EntrySummary, to: HTMLElement) => {
      document.elementFromPoint = () => to.querySelector('.poster');
      page.dragStarted(from);
      page.dragMoved({ pointerPosition: { x: 1, y: 1 } });
      await harness.fixture.whenStable();
      expect(to.classList).toContain('drop-target');
      // Wrapped, so awaiting dragOnto doesn't wait for the whole drop.
      return { done: page.dragEnded({ source: { reset: () => {} }, dropPoint: { x: 1, y: 1 } }) };
    };
    expect(cells()[0].classList).toContain('cdk-drag');

    // Naruto, tome 2 onto Naruto T1: a new series, named after the target.
    const ask = vi.spyOn(window, 'prompt').mockReturnValue(' Naruto ');
    const first = (await dragOnto(naruto[1], cells()[0])).done;
    expect(ask).toHaveBeenCalledWith('Nom de la série :', 'Naruto');
    const create = http.expectOne({ method: 'POST', url: '/api/media/series' });
    expect(create.request.body).toEqual({ name: 'Naruto' });
    create.flush({ id: 7, name: 'Naruto', volumes: 0, read: 0, owned: 0, cover_item: null });
    await settle();
    const target = http.expectOne({ method: 'PATCH', url: '/api/media/library/9' });
    expect(target.request.body).toEqual({ series_id: 7, series_volume: 1 });
    target.flush(naruto[0]);
    await settle();
    const dragged = http.expectOne({ method: 'PATCH', url: '/api/media/library/10' });
    expect(dragged.request.body).toEqual({ series_id: 7, series_volume: 2 });
    dragged.flush(naruto[1]);
    await settle();
    const series = {
      id: 7,
      name: 'Naruto',
      volumes: 2,
      read: 0,
      owned: 0,
      cover_item: naruto[0].item,
    };
    const filed = { series_id: 7, series_name: 'Naruto' };
    http
      .expectOne((r) => r.url === '/api/media/library')
      .flush([book(9, 'Naruto T1', filed), book(10, 'Naruto, tome 2', filed), naruto[2]]);
    http.expectOne('/api/media/series').flush([series]);
    await first;
    await harness.fixture.whenStable();
    expect(cells().map((c) => c.getAttribute('data-testid'))).toEqual(['series', 'entry']);

    // Saga onto the series card: joins it after its highest volume.
    const second = (await dragOnto(naruto[2], cells()[0])).done;
    await settle();
    http.expectOne('/api/media/series/7').flush({
      ...series,
      entries: [book(9, 'Naruto T1', { ...filed, series_volume: 1 })],
    });
    await settle();
    const join = http.expectOne({ method: 'PATCH', url: '/api/media/library/11' });
    expect(join.request.body).toEqual({ series_id: 7, series_volume: 2 });
    join.flush(naruto[2]);
    await settle();
    http.expectOne((r) => r.url === '/api/media/library').flush([]);
    http.expectOne('/api/media/series').flush([series]);
    await settle();
    await second;
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
