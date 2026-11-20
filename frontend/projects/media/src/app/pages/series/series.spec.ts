import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { BookSeriesDetail } from '../../media/models';
import { BOOK, entry, flushMe, settle, setup } from '../../testing';
import { SeriesPage } from './series';
import { Dialogs } from '../../ui/dialogs';

const vol = (id: number, volume: number | null, overrides = {}) =>
  entry({
    id,
    item: { ...BOOK, id: 40 + id, title: `One Piece ${volume ?? 'spécial'}` },
    series_id: 4,
    series_name: 'One Piece',
    series_volume: volume,
    ...overrides,
  });

const SERIES: BookSeriesDetail = {
  id: 4,
  name: 'One Piece',
  volumes: 3,
  read: 1,
  owned: 1,
  cover_item: null,
  entries: [vol(1, 1, { status: 'done', owned: true }), vol(2, 2), vol(3, null)],
};

describe('SeriesPage', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<SeriesPage>;
  let el: HTMLElement;

  beforeEach(async () => {
    http = setup();
    vi.spyOn(TestBed.inject(Dialogs), 'confirm').mockResolvedValue(true);
    fixture = TestBed.createComponent(SeriesPage);
    fixture.componentRef.setInput('id', '4');
    flushMe(http);
    fixture.detectChanges();
    http.expectOne('/api/media/series/4').flush(SERIES);
    await settle();
    await fixture.whenStable();
    el = fixture.nativeElement;
  });
  afterEach(() => http.verify());

  const button = (text: string) =>
    [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === text,
    ) as HTMLButtonElement;

  async function answer(method: string, url: string, detail: BookSeriesDetail = SERIES) {
    const req = http.expectOne({ method, url });
    req.flush(detail);
    await settle();
    await fixture.whenStable();
    return req.request.body;
  }

  it('lists the volumes in order with their counts', () => {
    expect((el.querySelector('input.name') as HTMLInputElement).value).toBe('One Piece');
    expect(el.querySelector('.counts')?.textContent?.trim()).toBe('3 tomes · 1 lus · 1 possédés');
    const rows = [...el.querySelectorAll('[data-testid="volume"]')];
    expect(rows.map((r) => r.querySelector('.number')?.textContent?.trim())).toEqual([
      't. 1',
      't. 2',
      '—',
    ]);
    expect(rows[0].querySelector('.status')?.textContent).toBe('Lu');
    expect(rows[0].querySelector('.btn')).toBeNull();
    expect(rows[1].querySelector('a.poster')?.getAttribute('href')).toBe('/entries/2');
    expect(rows[1].querySelector('a.poster strong')?.textContent).toBe('One Piece 2');
    expect(el.querySelector('.head a.btn')?.getAttribute('href')).toBe('/add?type=book&series=4');
  });

  it('reads one volume undated and toggles one owned, then refreshes', async () => {
    const rows = [...el.querySelectorAll('[data-testid="volume"]')];
    (rows[1].querySelector('.btn') as HTMLButtonElement).click();
    const finish = http.expectOne((r) => r.url === '/api/media/library/2/finish');
    expect(finish.request.params.get('undated')).toBe('true');
    finish.flush(vol(2, 2, { status: 'done' }));
    await settle();
    await answer('GET', '/api/media/series/4');

    (rows[1].querySelector('.chip') as HTMLButtonElement).click();
    const patch = http.expectOne({ method: 'PATCH', url: '/api/media/library/2' });
    expect(patch.request.body).toEqual({ owned: true });
    patch.flush(vol(2, 2, { owned: true }));
    await settle();
    await answer('GET', '/api/media/series/4');
  });

  it('renames on blur and deletes after confirmation', async () => {
    const name = el.querySelector('input.name') as HTMLInputElement;
    name.value = ' ワンピース ';
    name.dispatchEvent(new Event('input'));
    name.dispatchEvent(new Event('blur'));
    expect(await answer('PATCH', '/api/media/series/4', { ...SERIES, name: 'ワンピース' })).toEqual(
      { name: 'ワンピース' },
    );

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    button('Supprimer la série').click();
    expect(TestBed.inject(Dialogs).confirm).toHaveBeenCalledWith({
      title: 'series.delete',
      message: 'series.confirmDelete',
      params: { name: 'ワンピース' },
      confirm: 'dialog.delete',
      danger: true,
    });
    await settle();
    http
      .expectOne({ method: 'DELETE', url: '/api/media/series/4' })
      .flush(null, { status: 204, statusText: '' });
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/books']);
  });
});
