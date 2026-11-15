import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  PNG,
  bytesOf,
  catchDownloads,
  click,
  describePdf,
  fileOf,
  pick,
  settle,
  setup,
  text,
} from '../testing';
import { ImagesToPdf } from './images-to-pdf';

describe('ImagesToPdf', () => {
  let fixture: ComponentFixture<ImagesToPdf>;
  let el: HTMLElement;
  let downloads: ReturnType<typeof catchDownloads>;

  beforeEach(async () => {
    setup();
    downloads = catchDownloads();
    fixture = TestBed.createComponent(ImagesToPdf);
    el = fixture.nativeElement;
    await fixture.whenStable();
  });

  afterEach(() => vi.restoreAllMocks());

  const pressed = (group: string) =>
    text(el.querySelector(`[aria-labelledby="${group}"] [aria-pressed="true"]`));

  it('adds JPG and PNG images, skips the rest, and creates the PDF', async () => {
    pick(el, [
      fileOf(PNG, 'a.png', 'image/png'),
      fileOf('gif', 'b.gif', 'image/gif'),
      fileOf(PNG, 'c.png', 'image/png'),
    ]);
    await settle(fixture);
    expect([...el.querySelectorAll('.image-tile .page-label')].map(text)).toEqual([
      'a.png',
      'c.png',
    ]);
    expect(text(el.querySelector('.notice'))).toBe(
      "b.gif n'est pas une image JPG ou PNG : ignoré.",
    );
    expect(text(el.querySelector('.summary'))).toBe('2 images → 2 pages');
    expect([pressed('opt-size'), pressed('opt-orientation'), pressed('opt-margin')]).toEqual([
      'A4',
      'Auto',
      'Petites',
    ]);

    click(el, 'Letter');
    await fixture.whenStable();
    click(el, 'Créer le PDF');
    await settle(fixture);
    expect(downloads.map((d) => d.name)).toEqual(['images.pdf']);
    // A 2×1 image in auto orientation: landscape Letter pages.
    expect((await describePdf(await bytesOf(downloads[0].blob))).map((p) => p.width)).toEqual([
      792, 792,
    ]);
  });

  it('turns orientation and margins off for "fit image"', async () => {
    click(el, "Taille de l'image");
    await fixture.whenStable();
    const disabled = [
      ...el.querySelectorAll<HTMLButtonElement>('[aria-labelledby="opt-margin"] button'),
    ].map((b) => b.disabled);
    expect(disabled).toEqual([true, true, true]);
  });

  it('drops an image it cannot embed and says so', async () => {
    pick(el, [fileOf(PNG, 'ok.png', 'image/png'), fileOf('not really', 'fake.jpg', 'image/jpeg')]);
    await settle(fixture);
    click(el, 'Créer le PDF');
    await settle(fixture);
    expect(downloads).toEqual([]);
    expect([...el.querySelectorAll('.image-tile .page-label')].map(text)).toEqual(['ok.png']);
    expect(text(el.querySelector('.notice'))).toBe(
      'fake.jpg est illisible (endommagé ?) : ignoré.',
    );
  });
});
