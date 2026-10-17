import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { EntrySummary } from '../media/models';
import { SERIES, entry, flushMe, settle, setup } from '../testing';
import { QuickActions } from './quick-actions';

describe('QuickActions', () => {
  let http: HttpTestingController;

  beforeEach(() => (http = setup()));
  afterEach(() => http.verify());

  async function render(e: EntrySummary) {
    const fixture = TestBed.createComponent(QuickActions);
    fixture.componentRef.setInput('entry', e);
    flushMe(http);
    await fixture.whenStable();
    return fixture;
  }

  const label = async (e: EntrySummary) =>
    ((await render(e)).nativeElement as HTMLElement).querySelector('button')?.textContent?.trim() ??
    null;

  it.each([
    ['a wanted book', entry({ item: { ...SERIES, type: 'book' } }), 'Commencer la lecture'],
    ['a dropped film', entry({ status: 'dropped' }), 'Reprendre'],
    ['a film in progress', entry({ status: 'in_progress' }), 'Terminer'],
    ['a series in progress', entry({ item: SERIES, status: 'in_progress' }), '+1 épisode'],
    [
      'a series at its last known episode',
      entry({ item: SERIES, status: 'in_progress', at_last_known_episode: true }),
      'Terminer',
    ],
    ['a finished film', entry({ status: 'done' }), null],
  ])('offers the next step for %s', async (_, e, expected) => {
    expect(await label(e)).toBe(expected);
  });

  it('emits the updated entry, or shows the error', async () => {
    const fixture = await render(entry({ item: SERIES, status: 'in_progress' }));
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector('button')!.click();
    const updated = entry({ item: SERIES, status: 'in_progress', current_episode: 1 });
    http.expectOne({ method: 'POST', url: '/api/media/library/3/next-episode' }).flush(updated);
    await settle();
    expect(changed).toHaveBeenCalledWith(updated);

    el.querySelector('button')!.click();
    http
      .expectOne('/api/media/library/3/next-episode')
      .flush({ detail: 'Start the series first' }, { status: 409, statusText: 'Conflict' });
    await settle();
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('Start the series first');
  });
});
