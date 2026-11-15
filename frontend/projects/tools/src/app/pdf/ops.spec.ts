import { PDFDocument, degrees } from 'pdf-lib';

import { PNG, describePdf, numbered } from '../testing';
import { ImageError, PdfError, assemble, imageLayout, imagesToPdf, pageCount, split } from './ops';

describe('pageCount', () => {
  it('counts pages', async () => {
    expect(await pageCount(await numbered(3))).toBe(3);
  });

  it('rejects what is not a PDF', async () => {
    await expect(pageCount(new TextEncoder().encode('not a pdf'))).rejects.toEqual(
      new PdfError('invalid'),
    );
  });
});

describe('assemble', () => {
  it('takes pages from several files, in the given order', async () => {
    const a = await numbered(3); // 101, 102, 103
    const b = await numbered(2, 11); // 111, 112
    const out = await assemble({ a, b }, [
      { source: 'b', index: 1 },
      { source: 'a', index: 0 },
      { source: 'b', index: 0 },
      { source: 'a', index: 2 },
    ]);
    expect((await describePdf(out)).map((p) => p.width)).toEqual([112, 101, 111, 103]);
  });

  it('adds rotations to the page own rotation, normalized', async () => {
    const doc = await PDFDocument.load(await numbered(2));
    doc.getPage(1).setRotation(degrees(90));
    const src = await doc.save();
    const out = await assemble({ src }, [
      { source: 'src', index: 0, rotate: -90 },
      { source: 'src', index: 1, rotate: 360 + 180 },
    ]);
    expect(await describePdf(out)).toEqual([
      { width: 101, rotate: 270 },
      { width: 102, rotate: 270 },
    ]);
  });
});

describe('split', () => {
  it('makes one PDF per range', async () => {
    const out = await split(await numbered(5), [
      [1, 2],
      [4, 4],
    ]);
    expect(
      await Promise.all(out.map(async (pdf) => (await describePdf(pdf)).map((p) => p.width))),
    ).toEqual([[101, 102], [104]]);
  });
});

describe('imageLayout', () => {
  const a4 = { size: 'a4', orientation: 'auto', margin: 'none' } as const;

  it('fits and centres the image without stretching it', () => {
    const at = imageLayout(1000, 500, { ...a4, orientation: 'portrait' });
    expect(at.pageWidth).toBeCloseTo(595.28, 1);
    expect(at.pageHeight).toBeCloseTo(841.89, 1);
    expect(at.width).toBeCloseTo(595.28, 1);
    expect(at.height).toBeCloseTo(297.64, 1);
    expect(at.y).toBeCloseTo((841.89 - 297.64) / 2, 1);
  });

  it('follows the image in auto orientation, and keeps the margins', () => {
    const at = imageLayout(1000, 500, { ...a4, margin: 'large' });
    expect(at.pageWidth).toBeGreaterThan(at.pageHeight);
    expect(at.x).toBeGreaterThanOrEqual(56.6);
    expect(at.y).toBeGreaterThanOrEqual(56.6);
    expect(at.width / at.height).toBeCloseTo(2, 5);
  });

  it('makes the page the image size for "fit image", at 96 px per inch', () => {
    expect(
      imageLayout(960, 480, { size: 'fit', orientation: 'landscape', margin: 'large' }),
    ).toEqual({
      pageWidth: 720,
      pageHeight: 360,
      x: 0,
      y: 0,
      width: 720,
      height: 360,
    });
  });
});

describe('imagesToPdf', () => {
  it('makes one page per image', async () => {
    const out = await imagesToPdf(
      [
        { bytes: PNG, type: 'png' },
        { bytes: PNG, type: 'png' },
      ],
      { size: 'letter', orientation: 'portrait', margin: 'small' },
    );
    expect(await describePdf(out)).toEqual([
      { width: 612, rotate: 0 },
      { width: 612, rotate: 0 },
    ]);
  });

  it('names the image it could not read', async () => {
    const bad = { bytes: new Uint8Array([1, 2, 3]), type: 'jpg' as const };
    await expect(
      imagesToPdf([{ bytes: PNG, type: 'png' }, bad], {
        size: 'a4',
        orientation: 'auto',
        margin: 'none',
      }),
    ).rejects.toEqual(new ImageError(1));
  });
});
