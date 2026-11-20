import { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { JournalEntry } from '../../media/models';
import { BOOK, SERIES, entry, flushMe, settle, setup } from '../../testing';
import { Journal } from './journal';

const EVENTS: JournalEntry[] = [
  { date: '2026-11-10', event: 'started', session_id: 3, entry: entry({ id: 3, item: SERIES }) },
  {
    date: '2026-11-03',
    event: 'finished',
    session_id: 2,
    entry: entry({ id: 2, status: 'done', rating: 8 }),
  },
  {
    date: '2026-11-03',
    event: 'finished',
    session_id: 1,
    entry: entry({ id: 1, item: BOOK, status: 'done' }),
  },
];

describe('Journal', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    http = setup([{ path: 'journal', component: Journal }]);
    harness = await RouterTestingHarness.create();
    flushMe(http);
  });
  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  const journalRequest = (): TestRequest => http.expectOne((r) => r.url === '/api/media/journal');

  async function open(url: string, events = EVENTS) {
    const navigation = harness.navigateByUrl(url);
    await settle();
    const req = journalRequest();
    const params = Object.fromEntries(new URLSearchParams(req.request.params.toString()));
    req.flush(events);
    await navigation;
    await harness.fixture.whenStable();
    return { el: harness.routeNativeElement as HTMLElement, params };
  }

  async function click(el: HTMLElement, selector: string, events: JournalEntry[] = []) {
    (el.querySelector(selector) as HTMLElement).click();
    await settle();
    const req = journalRequest();
    req.flush(events);
    await settle();
    await harness.fixture.whenStable();
    return Object.fromEntries(new URLSearchParams(req.request.params.toString()));
  }

  it('opens on the current month', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 20) });
    const { el, params } = await open('/journal', []);
    expect(params).toEqual({ year: '2026', month: '11' });
    expect(el.querySelector('.period h2')?.textContent?.trim()).toBe('novembre 2026');
    expect(el.querySelector('.empty')?.textContent).toBe("Rien d'enregistré sur cette période.");
  });

  it('groups a month by day with a summary of what was finished', async () => {
    const { el } = await open('/journal?year=2026&month=11');
    expect([...el.querySelectorAll('.group h3')].map((h) => h.textContent?.trim())).toEqual([
      'mardi 10 novembre',
      'mardi 3 novembre',
    ]);
    const rows = [...el.querySelectorAll('[data-testid="event"]')];
    expect(rows.map((r) => r.querySelector('.title')?.textContent)).toEqual([
      'Severance',
      'Matrix',
      'Dune',
    ]);
    expect(rows.map((r) => r.querySelector('.event')?.textContent?.trim())).toEqual([
      'Commencé',
      'Vu  4',
      'Lu',
    ]);
    expect(rows[1].querySelector('.title')?.getAttribute('href')).toBe('/entries/2');
    expect(
      [...el.querySelectorAll('.summary [data-type]')].map((s) => s.textContent?.trim()),
    ).toEqual(['1 livre lu', '1 film']);
  });

  it('shows a year grouped by month and steps years', async () => {
    const { el, params } = await open('/journal?year=2026&type=book&event=finished');
    expect(params).toEqual({ year: '2026', type: 'book', event: 'finished' });
    expect(el.querySelector('.period h2')?.textContent?.trim()).toBe('2026');
    expect([...el.querySelectorAll('.group h3')].map((h) => h.textContent?.trim())).toEqual([
      'novembre',
    ]);
    expect(await click(el, '.period button:first-child')).toEqual({
      year: '2025',
      type: 'book',
      event: 'finished',
    });
    expect(TestBed.inject(Router).url).toBe('/journal?year=2025&type=book&event=finished');
  });

  it('steps months across a year and switches views', async () => {
    const { el } = await open('/journal?year=2026&month=1', []);
    expect(await click(el, '.period button:first-child')).toEqual({ year: '2025', month: '12' });
    expect(await click(el, '.period button:last-child')).toEqual({ year: '2026', month: '1' });
    const [, year] = [...el.querySelectorAll('.view .chip')] as HTMLElement[];
    year.click();
    await settle();
    journalRequest().flush([]);
    await settle();
    expect(TestBed.inject(Router).url).toBe('/journal?year=2026');
  });
});
