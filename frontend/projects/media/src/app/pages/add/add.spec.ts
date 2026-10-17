import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { SearchResult } from '../../media/models';
import { entry, flushMe, settle, setup } from '../../testing';
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
    (el.querySelector('form.search button') as HTMLButtonElement).click();
    const req = http.expectOne((r) => r.url === '/api/media/search');
    expect(req.request.params.get('type')).toBe(
      kind === 'Livre' ? 'book' : kind === 'Film' ? 'film' : 'series',
    );
    expect(req.request.params.get('q')).toBe(q.trim());
    req.flush(results);
    await fixture.whenStable();
  }

  it('says which source it searches', async () => {
    expect(el.querySelector('.source')?.textContent?.trim()).toBe('Recherche dans Open Library.');
    button('Film').click();
    await fixture.whenStable();
    expect(el.querySelector('.source')?.textContent?.trim()).toBe('Recherche dans TMDB.');
  });

  it('adds a search result with the chosen status and formats, then opens it', async () => {
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
    button('Vu').click();
    button('Blu-ray').click();
    await fixture.whenStable();
    button('Ajouter à la bibliothèque').click();

    const req = http.expectOne({ method: 'POST', url: '/api/media/library/from-search' });
    expect(req.request.body).toEqual({
      source: 'tmdb',
      external_id: '603',
      type: 'film',
      status: 'done',
      owned_formats: ['bluray'],
    });
    req.flush(entry({ id: 9 }));
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/library', 9]);
  });

  it('opens the entry of a result already in the library', async () => {
    await search('Film', 'matrix');
    (el.querySelectorAll('.results .result')[1] as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/library', 42]);
  });

  it('shows a source failure', async () => {
    button('Série').click();
    type('input[name="q"]', 'x');
    await fixture.whenStable();
    (el.querySelector('form.search button') as HTMLButtonElement).click();
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
    button('Poche').click();
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
      owned_formats: ['paperback'],
    });
    req.flush(entry({ id: 11 }));
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/library', 11]);
  });
});
