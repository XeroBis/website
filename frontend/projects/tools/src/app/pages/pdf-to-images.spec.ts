import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  FakeRenderer,
  catchDownloads,
  click,
  fileOf,
  numbered,
  pick,
  settle,
  setup,
  text,
  unzip,
} from '../testing';
import { PdfToImages } from './pdf-to-images';

describe('PdfToImages', () => {
  let fixture: ComponentFixture<PdfToImages>;
  let el: HTMLElement;
  let renderer: FakeRenderer;
  let downloads: ReturnType<typeof catchDownloads>;

  beforeEach(async () => {
    ({ renderer } = setup());
    downloads = catchDownloads();
    fixture = TestBed.createComponent(PdfToImages);
    el = fixture.nativeElement;
    await fixture.whenStable();
    pick(el, [fileOf(await numbered(3), 'slides.pdf')]);
    await settle(fixture);
  });

  afterEach(() => vi.restoreAllMocks());

  it('selects every page at first and zips them as PNG at 150 dpi', async () => {
    expect(text(el.querySelector('.summary'))).toBe('3 pages sur 3 sélectionnées');
    expect(text(el.querySelector('.output .mono'))).toBe('slides-images.zip');
    click(el, 'Télécharger 3 images (.zip)');
    await settle(fixture);
    expect(renderer.images).toEqual([
      { index: 0, dpi: 150, type: 'image/png', quality: undefined },
      { index: 1, dpi: 150, type: 'image/png', quality: undefined },
      { index: 2, dpi: 150, type: 'image/png', quality: undefined },
    ]);
    expect(downloads.map((d) => d.name)).toEqual(['slides-images.zip']);
    const files = await unzip(downloads[0].blob);
    expect(Object.keys(files)).toEqual(['slides-p1.png', 'slides-p2.png', 'slides-p3.png']);
    expect(new TextDecoder().decode(files['slides-p2.png'])).toBe('page 2');
  });

  it('downloads a single page as one JPG, at the chosen resolution and quality', async () => {
    click(el, 'Aucune');
    await fixture.whenStable();
    click(el, 'Page 2');
    click(el, 'JPG');
    click(el, '300 dpi');
    await fixture.whenStable();
    const range = el.querySelector<HTMLInputElement>('input[type=range]')!;
    range.value = '60';
    range.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(text(el.querySelector('.output .mono'))).toBe('slides-p2.jpg');
    click(el, "Télécharger l'image");
    await settle(fixture);
    expect(renderer.images).toEqual([{ index: 1, dpi: 300, type: 'image/jpeg', quality: 0.6 }]);
    expect(downloads.map((d) => d.name)).toEqual(['slides-p2.jpg']);
  });
});
