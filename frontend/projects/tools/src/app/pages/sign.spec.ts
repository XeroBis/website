import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PDFDocument, PDFName } from 'pdf-lib';

import {
  FakeRaster,
  PNG,
  bytesOf,
  catchDownloads,
  click,
  fileOf,
  numbered,
  pick,
  settle,
  setup,
  text,
} from '../testing';
import { Sign } from './sign';

describe('Sign', () => {
  let fixture: ComponentFixture<Sign>;
  let el: HTMLElement;
  let raster: FakeRaster;
  let downloads: ReturnType<typeof catchDownloads>;

  beforeEach(async () => {
    ({ raster } = setup());
    downloads = catchDownloads();
    fixture = TestBed.createComponent(Sign);
    el = fixture.nativeElement;
    await fixture.whenStable();
  });

  afterEach(() => vi.restoreAllMocks());

  const imageInput = () =>
    [...el.querySelectorAll<HTMLInputElement>('input[type=file]')].find((i) =>
      i.accept.includes('image/png'),
    )!;
  const addImages = async (files: File[]) => {
    Object.defineProperty(imageInput(), 'files', { value: files, configurable: true });
    imageInput().dispatchEvent(new Event('change'));
    await settle(fixture);
  };
  const openPdf = async (pages = 3) => {
    pick(el, [fileOf(await numbered(pages), 'contract.pdf')]);
    await settle(fixture);
  };
  const summary = () => text(el.querySelector('.summary'));
  const stamps = () => [...el.querySelectorAll<HTMLElement>('.stamp')];
  const imagesOnPages = async (bytes: Uint8Array) =>
    (await PDFDocument.load(bytes))
      .getPages()
      .map((p) => p.node.Resources()?.lookup(PDFName.of('XObject')) !== undefined);

  it('places an image on the page shown and saves it', async () => {
    await openPdf();
    expect(el.querySelectorAll('.sign-thumb')).toHaveLength(3);
    expect(summary()).toBe('0 image placée');
    expect(el.querySelector<HTMLButtonElement>('.action-bar .btn-primary')!.disabled).toBe(true);

    await addImages([fileOf(PNG, 'sig.png', 'image/png'), fileOf('gif', 'x.gif', 'image/gif')]);
    expect(text(el.querySelector('.notice'))).toBe(
      "x.gif n'est pas une image JPG ou PNG : ignoré.",
    );
    expect(raster.cleaned).toEqual([]); // a PNG is kept as is

    click(el, 'Page 2');
    await fixture.whenStable();
    click(el, 'Placer sig.png sur la page');
    await fixture.whenStable();
    expect(stamps()).toHaveLength(1);
    expect(stamps()[0].classList).toContain('selected');
    // 30 % of the page's width, centred; 200×100 image on a 102×500 page.
    expect(stamps()[0].style.left).toBe('35%');
    expect(stamps()[0].style.width).toBe('30%');
    expect(text(el.querySelector('.sign-thumb[aria-pressed=true] .sign-count'))).toBe('1');
    expect(summary()).toBe('1 image placée · sur 1 page');

    click(el, 'Enregistrer le PDF');
    await settle(fixture);
    expect(downloads.map((d) => d.name)).toEqual(['contract-signed.pdf']);
    expect(await imagesOnPages(await bytesOf(downloads[0].blob))).toEqual([false, true, false]);
  });

  it('copies a stamp to every page, and removes stamps', async () => {
    await openPdf();
    await addImages([fileOf(PNG, 'sig.png', 'image/png')]);
    click(el, 'Placer sig.png sur la page');
    await fixture.whenStable();
    click(el, 'Copier sur toutes les pages');
    await fixture.whenStable();
    expect(summary()).toBe('3 images placées · sur 3 pages');

    stamps()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    await fixture.whenStable();
    expect(stamps()).toHaveLength(0);
    expect(summary()).toBe('2 images placées · sur 2 pages');

    click(el, 'Retirer sig.png');
    await fixture.whenStable();
    expect(summary()).toBe('0 image placée');
  });

  it('moves a stamp with the keyboard, kept inside the page', async () => {
    await openPdf(1);
    expect(el.querySelector('.sign-strip')).toBeNull();
    await addImages([fileOf(PNG, 'sig.png', 'image/png')]);
    click(el, 'Placer sig.png sur la page');
    await fixture.whenStable();
    for (let i = 0; i < 20; i++) {
      stamps()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }));
    }
    await fixture.whenStable();
    expect(stamps()[0].style.left).toBe('0%');
  });

  it('removes the white background of a JPG, and can turn it off', async () => {
    await addImages([fileOf('jpg', 'scan.jpg', 'image/jpeg')]);
    expect(raster.cleaned).toEqual([{ strength: 50 }]);
    // No PDF yet: the image waits.
    expect(text(el.querySelector('.hint'))).toBe('Ouvrez un PDF pour les placer.');
    expect(el.querySelector<HTMLButtonElement>('.sign-image-pick')!.disabled).toBe(true);

    const slider = el.querySelector<HTMLInputElement>('.sign-strength input')!;
    slider.value = '80';
    slider.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(raster.cleaned.at(-1)).toEqual({ strength: 80 });

    const box = el.querySelector<HTMLInputElement>('.sign-check input')!;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(el.querySelector('.sign-strength')).toBeNull();
    expect(raster.cleaned).toHaveLength(2);
  });

  it('adds a drawn signature and places it at once', async () => {
    await openPdf();
    click(el, 'Dessiner une signature');
    await fixture.whenStable();
    expect(el.querySelector('[role=dialog]')).not.toBeNull();
    const sign = fixture.componentInstance as unknown as { addDrawing(b: Blob): Promise<void> };
    await sign.addDrawing(new Blob([PNG.slice()], { type: 'image/png' }));
    await settle(fixture);
    expect(el.querySelector('[role=dialog]')).toBeNull();
    expect(text(el.querySelector('.sign-image .chip-name'))).toBe('signature-1.png');
    expect(el.querySelector('.sign-check')).toBeNull(); // nothing to clean on a drawing
    expect(stamps()).toHaveLength(1);
  });
});
