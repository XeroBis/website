import { Injectable } from '@angular/core';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';

type PdfJs = typeof import('pdfjs-dist');

/**
 * Draws PDF pages with pdf.js: thumbnails and full-size images. pdf.js (and
 * its worker) are loaded on first use. Renders run one at a time, so a
 * 300-page file doesn't paint 300 canvases at once. Tests provide a fake.
 */
@Injectable({ providedIn: 'root' })
export class PdfRenderer {
  private lib?: Promise<PdfJs>;
  private readonly docs = new Map<Uint8Array, Promise<PDFDocumentProxy>>();
  private queue: Promise<unknown> = Promise.resolve();

  private pdfjs(): Promise<PdfJs> {
    this.lib ??= import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('./pdf.worker', import.meta.url), {
        type: 'module',
      });
      return pdfjs;
    });
    return this.lib;
  }

  private document(bytes: Uint8Array): Promise<PDFDocumentProxy> {
    let doc = this.docs.get(bytes);
    if (!doc) {
      // pdf.js transfers the buffer to its worker: give it a copy.
      doc = this.pdfjs().then((pdfjs) => pdfjs.getDocument({ data: bytes.slice() }).promise);
      this.docs.set(bytes, doc);
    }
    return doc;
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Page `index` (0-based) as an image `width` CSS pixels wide (sharp on HiDPI). */
  thumbnail(bytes: Uint8Array, index: number, width: number): Promise<Blob> {
    return this.enqueue(async () => {
      const page = await (await this.document(bytes)).getPage(index + 1);
      const natural = page.getViewport({ scale: 1 }).width;
      const scale = (width * Math.min(window.devicePixelRatio || 1, 2)) / natural;
      return this.draw(page.getViewport({ scale }), page, 'image/png');
    });
  }

  /** Page `index` (0-based) at `dpi` (72 = the page's size in points). */
  image(
    bytes: Uint8Array,
    index: number,
    dpi: number,
    type: string,
    quality?: number,
  ): Promise<Blob> {
    return this.enqueue(async () => {
      const page = await (await this.document(bytes)).getPage(index + 1);
      return this.draw(page.getViewport({ scale: dpi / 72 }), page, type, quality);
    });
  }

  private async draw(
    viewport: PageViewport,
    page: PDFPageProxy,
    type: string,
    quality?: number,
  ): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    // White behind transparent pages, which JPG can't keep anyway.
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    page.cleanup();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    canvas.width = canvas.height = 0; // frees the bitmap now rather than at GC
    if (!blob) throw new Error('render failed');
    return blob;
  }

  /** Forgets a file's pdf.js document (call when it's removed from a tool). */
  release(bytes: Uint8Array): void {
    const doc = this.docs.get(bytes);
    this.docs.delete(bytes);
    void doc?.then((d) => d.destroy()).catch(() => undefined);
  }
}
