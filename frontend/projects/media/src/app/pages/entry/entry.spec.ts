import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { EntryDetail } from '../../media/models';
import { SERIES, entry, flushMe, settle, setup, switchToEnglish } from '../../testing';
import { EntryPage } from './entry';

describe('EntryPage', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<EntryPage>;
  let el: HTMLElement;

  beforeEach(() => {
    http = setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => http.verify());

  async function render(detail: EntryDetail | null = entry()) {
    fixture = TestBed.createComponent(EntryPage);
    fixture.componentRef.setInput('id', '3');
    flushMe(http);
    fixture.detectChanges();
    const req = http.expectOne('/api/media/library/3');
    if (detail) req.flush(detail);
    else req.flush({ detail: 'Entry not found' }, { status: 404, statusText: 'Not Found' });
    await settle();
    await fixture.whenStable();
    el = fixture.nativeElement;
  }

  const button = (text: string) =>
    [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === text,
    ) as HTMLButtonElement;
  const buttons = () =>
    [...el.querySelectorAll('.buttons button')].map((b) => b.textContent?.trim());

  async function answer(method: string, url: string, detail: EntryDetail) {
    const req = http.expectOne({ method, url });
    req.flush(detail);
    await settle();
    await fixture.whenStable();
    return req.request.body;
  }

  it('shows the item in the current language, with its other titles and facts', async () => {
    await render();
    expect(el.querySelector('h1')?.textContent).toBe('Matrix');
    expect(el.querySelector('.original')?.textContent).toBe('The Matrix');
    expect(el.querySelector('.pill.type')?.textContent?.trim()).toBe('Film');
    expect([...el.querySelectorAll('.facts span')].map((s) => s.textContent)).toEqual([
      '1999',
      'Lana Wachowski, Lilly Wachowski',
      '136 min',
    ]);
    expect(el.querySelector('.genres a')?.getAttribute('href')).toBe('/library?genre=Action');
    expect(el.querySelector('.synopsis')?.textContent).toBe('Néo.');
    expect(TestBed.inject(Title).getTitle()).toBe('Matrix · Media');
    expect(buttons()).toEqual(['Commencer', 'Déjà vu', 'Pas pour moi']);

    await switchToEnglish(http);
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toBe('The Matrix');
    expect(el.querySelector('.synopsis')?.textContent).toBe('Neo.');
    expect(TestBed.inject(Title).getTitle()).toBe('The Matrix · Media');
  });

  it('runs a status action', async () => {
    await render();
    button('Commencer').click();
    await answer(
      'POST',
      '/api/media/library/3/start',
      entry({
        status: 'in_progress',
        sessions: [{ id: 1, started_on: '2026-10-17', finished_on: null }],
      }),
    );
    expect(el.querySelector('.state')?.textContent).toBe('En cours');
    expect(buttons()).toEqual(['Terminer', 'Abandonner']);
    expect(el.querySelector('.sessions .when')?.textContent?.trim()).toBe('En cours');
  });

  it('shows a refused transition', async () => {
    await render(entry({ status: 'in_progress' }));
    button('Terminer').click();
    http
      .expectOne('/api/media/library/3/finish')
      .flush({ detail: 'Already done' }, { status: 409, statusText: 'Conflict' });
    await settle();
    await fixture.whenStable();
    expect(el.querySelector('.error')?.textContent).toBe('Already done');
  });

  it('offers +1 episode on a series in progress, and its progress', async () => {
    await render(
      entry({
        item: SERIES,
        status: 'in_progress',
        current_season: 1,
        current_episode: 9,
        progress: { watched: 9, total: 19 },
      }),
    );
    expect(buttons()).toEqual(['+1 épisode', 'Terminer', 'Abandonner']);
    expect(el.querySelector('.ring')?.textContent?.trim()).toBe('47%');
    expect(
      [...el.querySelectorAll('.state')].map((s) => s.textContent?.replace(/\s+/g, ' ').trim()),
    ).toEqual(['En cours', 'S1 · E9 sur 9']);
    button('+1 épisode').click();
    await answer(
      'POST',
      '/api/media/library/3/next-episode',
      entry({ item: SERIES, status: 'in_progress', current_season: 2, current_episode: 1 }),
    );
    expect((el.querySelector('.progress input') as HTMLInputElement).value).toBe('2');
  });

  it('rates, toggles a format and saves notes on blur', async () => {
    await render();
    (el.querySelectorAll('ab-star-rating .half.right')[2] as HTMLButtonElement).click();
    expect(await answer('PATCH', '/api/media/library/3', entry({ rating: 6 }))).toEqual({
      rating: 6,
    });
    expect(el.querySelector('ab-star-rating .value')?.textContent?.trim()).toBe('3 / 5');

    button('Blu-ray').click();
    expect(
      await answer('PATCH', '/api/media/library/3', entry({ owned_formats: ['bluray'] })),
    ).toEqual({
      owned_formats: ['bluray'],
    });

    const notes = el.querySelector('textarea') as HTMLTextAreaElement;
    notes.value = '  Great  ';
    notes.dispatchEvent(new Event('input'));
    notes.dispatchEvent(new Event('blur'));
    expect(await answer('PATCH', '/api/media/library/3', entry({ notes: 'Great' }))).toEqual({
      notes: 'Great',
    });
    expect(el.querySelector('.panel.wide .section-title small')?.textContent).toContain(
      'Enregistré',
    );
  });

  it('refuses a session finishing before it starts, in the page', async () => {
    await render();
    const [start, finish] = [...el.querySelectorAll('.new-session input')] as HTMLInputElement[];
    start.value = '2026-05-02';
    start.dispatchEvent(new Event('input'));
    finish.value = '2026-05-01';
    finish.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    (el.querySelector('.new-session button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(el.querySelector('.error')?.textContent).toBe(
      'La date de fin ne peut pas précéder la date de début.',
    );
  });

  it('adds a past session', async () => {
    await render();
    const [start, finish] = [...el.querySelectorAll('.new-session input')] as HTMLInputElement[];
    start.value = '2020-01-01';
    start.dispatchEvent(new Event('input'));
    finish.value = '2020-01-10';
    finish.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    (el.querySelector('.new-session button') as HTMLButtonElement).click();
    const body = await answer(
      'POST',
      '/api/media/library/3/sessions',
      entry({ sessions: [{ id: 4, started_on: '2020-01-01', finished_on: '2020-01-10' }] }),
    );
    expect(body).toEqual({ started_on: '2020-01-01', finished_on: '2020-01-10' });
    expect(el.querySelectorAll('.sessions li').length).toBe(1);
  });

  it('removes the entry after confirmation', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await render();
    button('Retirer de la bibliothèque').click();
    expect(window.confirm).toHaveBeenCalledWith(
      'Retirer « Matrix » de votre bibliothèque ? Ses sessions, sa note et ses notes seront supprimées.',
    );
    http
      .expectOne({ method: 'DELETE', url: '/api/media/library/3' })
      .flush(null, { status: 204, statusText: '' });
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/library']);
  });

  it("says when the entry doesn't exist (or isn't yours)", async () => {
    await render(null);
    expect(el.querySelector('.error')?.textContent).toBe('Entrée introuvable.');
    expect(el.querySelector('h1')).toBeNull();
  });
});
