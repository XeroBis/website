import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  bytesOf,
  catchDownloads,
  click,
  describePdf,
  fileOf,
  numbered,
  pick,
  settle,
  setup,
  text,
  unzip,
} from '../testing';
import { Extract } from './extract';

describe('Extract', () => {
  let fixture: ComponentFixture<Extract>;
  let el: HTMLElement;
  let downloads: ReturnType<typeof catchDownloads>;

  beforeEach(async () => {
    setup();
    downloads = catchDownloads();
    fixture = TestBed.createComponent(Extract);
    el = fixture.nativeElement;
    await fixture.whenStable();
    pick(el, [fileOf(await numbered(12), 'contract.pdf')]);
    await settle(fixture);
  });

  afterEach(() => vi.restoreAllMocks());

  const field = () => el.querySelector<HTMLInputElement>('.options-bar input')!;
  const selected = () =>
    [...el.querySelectorAll('.page.pick.selected')].map((b) =>
      Number(text(b.querySelector('.caption'))),
    );

  async function type(value: string): Promise<void> {
    field().value = value;
    field().dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  it('shows the file and its pages, none selected', () => {
    expect(text(el.querySelector('.file-head .chip-name'))).toBe('contract.pdf');
    expect(text(el.querySelector('.file-head .muted'))).toBe('12 pages');
    expect(el.querySelectorAll('.page.pick')).toHaveLength(12);
    expect(selected()).toEqual([]);
    expect(el.querySelector<HTMLButtonElement>('.btn-primary')!.disabled).toBe(true);
  });

  it('keeps the ranges field and the clicked pages in sync', async () => {
    await type('1-3, 7, 99, x');
    expect(selected()).toEqual([1, 2, 3, 7]);
    expect(el.querySelector('#ranges-error')!.hasAttribute('hidden')).toBe(false);
    expect(text(el.querySelector('#ranges-error'))).toBe(
      'Ignoré : 99, x (les pages vont de 1 à 12).',
    );

    click(el, 'Page 4');
    await fixture.whenStable();
    expect(field().value).toBe('1-4, 7');
    click(el, 'Page 2');
    await fixture.whenStable();
    expect(field().value).toBe('1, 3-4, 7');
    click(el, 'Toutes');
    await fixture.whenStable();
    expect(field().value).toBe('1-12');
  });

  it('extracts the selected pages as one PDF', async () => {
    await type('7, 1-2');
    click(el, 'Extraire les pages');
    await settle(fixture);
    expect(downloads.map((d) => d.name)).toEqual(['contract-pages.pdf']);
    expect((await describePdf(await bytesOf(downloads[0].blob))).map((p) => p.width)).toEqual([
      101, 102, 107,
    ]);
  });

  it('makes one PDF per range, zipped', async () => {
    await type('1-2, 5, 1-2');
    click(el, 'Un PDF par plage');
    await fixture.whenStable();
    expect(text(el.querySelector('.summary'))).toBe('3 pages · 2 PDF (zip)');
    click(el, 'Extraire les pages');
    await settle(fixture);
    expect(downloads.map((d) => d.name)).toEqual(['contract-split.zip']);
    const files = await unzip(downloads[0].blob);
    expect(Object.keys(files)).toEqual(['contract-1-2.pdf', 'contract-5.pdf']);
    expect((await describePdf(files['contract-5.pdf'])).map((p) => p.width)).toEqual([105]);
  });

  it('opening another file starts over', async () => {
    await type('1-3');
    pick(el, [fileOf(await numbered(4), 'other.pdf')]);
    await settle(fixture);
    expect(text(el.querySelector('.file-head .chip-name'))).toBe('other.pdf');
    expect(field().value).toBe('');
    expect(el.querySelectorAll('.page.pick')).toHaveLength(4);
  });
});
