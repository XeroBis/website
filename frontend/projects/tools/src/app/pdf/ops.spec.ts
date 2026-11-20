import { PDFDocument, PDFName, PDFRawStream, degrees } from 'pdf-lib';

import { PNG, describePdf, numbered } from '../testing';
import {
  ImageError,
  PdfError,
  assemble,
  imageLayout,
  imagesToPdf,
  pageBoxes,
  pageCount,
  split,
  stampPdf,
  stampPlacement,
} from './ops';

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

describe('pageBoxes', () => {
  it('gives each page as shown, turned pages swapped', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 200]);
    doc.addPage([100, 200]).setRotation(degrees(90));
    expect(await pageBoxes(await doc.save())).toEqual([
      { width: 100, height: 200 },
      { width: 200, height: 100 },
    ]);
  });
});

describe('stampPlacement', () => {
  // A 100×200 page; the image covers the top left tenth by fifth of the page as shown.
  const box = { x: 0, y: 0, width: 100, height: 200 };
  const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 };

  it('flips y on an unturned page', () => {
    expect(stampPlacement(rect, box, 0)).toEqual({
      x: 10,
      y: 200 - 60, // the image's bottom is 30% down the page
      width: 30,
      height: 20,
      rotate: 0,
    });
  });

  it('offsets by the crop box', () => {
    const at = stampPlacement(rect, { ...box, x: 5, y: 7 }, 0);
    expect([at.x, at.y]).toEqual([15, 147]);
  });

  // Shown turned, the page is 200×100: the image is 60×10, its bottom left at (20, 30) as shown.
  it.each([
    [90, { x: 30, y: 20 }],
    [180, { x: 100 - 10, y: 60 }],
    [270, { x: 100 - 30, y: 200 - 20 }],
    [-90, { x: 100 - 30, y: 200 - 20 }],
  ])('turns with the page (%i°)', (rotation, corner) => {
    const at = stampPlacement(rect, box, rotation);
    const shownW = rotation % 180 ? 200 : 100;
    const shownH = rotation % 180 ? 100 : 200;
    const round = (v: number) => Math.round(v * 1000) / 1000;
    expect(Object.fromEntries(Object.entries(at).map(([k, v]) => [k, round(v)]))).toEqual({
      ...corner,
      width: round(0.3 * shownW),
      height: round(0.1 * shownH),
      rotate: ((rotation % 360) + 360) % 360,
    });
  });
});

describe('stampPdf', () => {
  it('draws each image on its pages, embedding it once', async () => {
    const out = await stampPdf(await numbered(3), { sig: { bytes: PNG, type: 'png' } }, [
      { image: 'sig', page: 0, x: 0, y: 0, width: 0.5, height: 0.1 },
      { image: 'sig', page: 2, x: 0.5, y: 0.9, width: 0.5, height: 0.1 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
    const images = doc.context
      .enumerateIndirectObjects()
      .filter(
        ([, obj]) =>
          obj instanceof PDFRawStream &&
          obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'),
      );
    expect(images).toHaveLength(1);
    const xobjects = doc
      .getPages()
      .map((p) => p.node.Resources()?.lookup(PDFName.of('XObject')) !== undefined);
    expect(xobjects).toEqual([true, false, true]);
  });
});
