import { EncryptedPDFError, PDFDocument, PDFPage, degrees } from 'pdf-lib';

import { ImageType } from './files';
import { PageRange } from './ranges';

// Everything the tools do to PDFs, with pdf-lib, on bytes in memory.

export type PdfReadError = 'encrypted' | 'invalid';

/** Thrown by `pageCount` when a file can't be used. */
export class PdfError extends Error {
  constructor(readonly reason: PdfReadError) {
    super(reason);
  }
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    throw new PdfError(e instanceof EncryptedPDFError ? 'encrypted' : 'invalid');
  }
}

/** The number of pages, or a `PdfError` for a damaged or password-protected file. */
export async function pageCount(bytes: Uint8Array): Promise<number> {
  const count = (await load(bytes)).getPageCount();
  if (count === 0) throw new PdfError('invalid');
  return count;
}

/** One page of the output: page `index` (0-based) of source `source`, turned by `rotate`. */
export interface PagePick {
  source: string;
  index: number;
  /** Degrees clockwise, a multiple of 90, added to the page's own rotation. */
  rotate?: number;
}

const normalize = (angle: number) => ((angle % 360) + 360) % 360;

async function build(
  docs: Map<string, PDFDocument>,
  picks: readonly PagePick[],
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  // One copyPages per source (it copies shared resources once), then placed in order.
  const copied = new Map<string, PDFPage[]>();
  for (const [id, doc] of docs) {
    const indices = picks.filter((p) => p.source === id).map((p) => p.index);
    if (indices.length) copied.set(id, await out.copyPages(doc, indices));
  }
  for (const pick of picks) {
    const page = copied.get(pick.source)!.shift()!;
    if (pick.rotate) page.setRotation(degrees(normalize(page.getRotation().angle + pick.rotate)));
    out.addPage(page);
  }
  return out.save();
}

async function loadAll(sources: Record<string, Uint8Array>): Promise<Map<string, PDFDocument>> {
  const docs = new Map<string, PDFDocument>();
  for (const [id, bytes] of Object.entries(sources)) docs.set(id, await load(bytes));
  return docs;
}

/**
 * A new PDF of `picks`, in order, from `sources` (id → bytes): merge,
 * extract and organize are all this.
 */
export async function assemble(
  sources: Record<string, Uint8Array>,
  picks: readonly PagePick[],
): Promise<Uint8Array> {
  const used = new Set(picks.map((p) => p.source));
  const needed = Object.fromEntries(Object.entries(sources).filter(([id]) => used.has(id)));
  return build(await loadAll(needed), picks);
}

/** One PDF per range (1-based, inclusive), loading the source once. */
export async function split(
  bytes: Uint8Array,
  ranges: readonly PageRange[],
): Promise<Uint8Array[]> {
  const docs = await loadAll({ src: bytes });
  const out: Uint8Array[] = [];
  for (const [from, to] of ranges) {
    const picks: PagePick[] = [];
    for (let p = from; p <= to; p++) picks.push({ source: 'src', index: p - 1 });
    out.push(await build(docs, picks));
  }
  return out;
}

// Images → PDF.

export type PageSize = 'a4' | 'letter' | 'fit';
export type Orientation = 'auto' | 'portrait' | 'landscape';
export type Margin = 'none' | 'small' | 'large';

export interface ImageLayoutOptions {
  size: PageSize;
  orientation: Orientation;
  margin: Margin;
}

/** In PDF points (1/72 in): the page, and where the image sits on it. */
export interface ImageLayout {
  pageWidth: number;
  pageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const MM = 72 / 25.4;
const SIZES = { a4: [210 * MM, 297 * MM], letter: [612, 792] } as const;
export const MARGINS: Record<Margin, number> = { none: 0, small: 10 * MM, large: 20 * MM };
/** "Fit image" pages: an image pixel is a CSS pixel (96 per inch). */
const PX = 72 / 96;

/**
 * Where an image of `w`×`h` pixels goes: scaled to fit inside the margins
 * (never stretched), centred. "Fit image" makes the page the image's size,
 * without margins; "auto" orientation follows the image.
 */
export function imageLayout(w: number, h: number, opts: ImageLayoutOptions): ImageLayout {
  if (opts.size === 'fit') {
    return { pageWidth: w * PX, pageHeight: h * PX, x: 0, y: 0, width: w * PX, height: h * PX };
  }
  const [short, long] = SIZES[opts.size];
  const landscape = opts.orientation === 'landscape' || (opts.orientation === 'auto' && w > h);
  const [pageWidth, pageHeight] = landscape ? [long, short] : [short, long];
  const margin = MARGINS[opts.margin];
  const scale = Math.min((pageWidth - 2 * margin) / w, (pageHeight - 2 * margin) / h);
  const width = w * scale;
  const height = h * scale;
  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  };
}

export interface ImageInput {
  bytes: Uint8Array;
  type: ImageType;
}

/** Thrown by `imagesToPdf` for an image it can't read: `index` in its input. */
export class ImageError extends Error {
  constructor(readonly index: number) {
    super(`image ${index} unreadable`);
  }
}

/** One page per image, in order. Throws `ImageError` on an unreadable image. */
export async function imagesToPdf(
  images: readonly ImageInput[],
  opts: ImageLayoutOptions,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const [i, image] of images.entries()) {
    let embedded;
    try {
      embedded =
        image.type === 'jpg' ? await out.embedJpg(image.bytes) : await out.embedPng(image.bytes);
    } catch {
      throw new ImageError(i);
    }
    const at = imageLayout(embedded.width, embedded.height, opts);
    const page = out.addPage([at.pageWidth, at.pageHeight]);
    page.drawImage(embedded, { x: at.x, y: at.y, width: at.width, height: at.height });
  }
  return out.save();
}
