import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Provider } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Routes, provideRouter } from '@angular/router';
import { PDFDocument, PageSizes } from 'pdf-lib';
import { unzipSync } from 'fflate';

import { LanguageService, User, provideI18n } from '@shared';

import en from '../i18n/en.json';
import fr from '../i18n/fr.json';
import { Raster } from './pdf/raster';
import { PdfRenderer } from './pdf/renderer';

// Spec helpers.

export const USER: User = {
  id: 1,
  email: 'user@example.com',
  pseudo: 'Testy',
  language: 'fr',
  theme: 'system',
  is_admin: false,
  apps: ['tools'],
};

/** pdf.js needs a real canvas: specs get blank images instead, and the calls made. */
export class FakeRenderer {
  readonly images: { index: number; dpi: number; type: string; quality?: number }[] = [];
  readonly released: Uint8Array[] = [];

  thumbnail(): Promise<Blob> {
    return Promise.resolve(new Blob(['thumb'], { type: 'image/png' }));
  }

  image(
    _bytes: Uint8Array,
    index: number,
    dpi: number,
    type: string,
    quality?: number,
  ): Promise<Blob> {
    this.images.push({ index, dpi, type, quality });
    return Promise.resolve(new Blob([`page ${index + 1}`], { type }));
  }

  release(bytes: Uint8Array): void {
    this.released.push(bytes);
  }
}

/** No canvas in specs: every image is 200×100, cleaning returns the PNG fixture. */
export class FakeRaster {
  readonly cleaned: { strength: number }[] = [];

  size(blob: Blob): Promise<{ width: number; height: number } | null> {
    return Promise.resolve(blob.size ? { width: 200, height: 100 } : null);
  }

  clearWhite(_blob: Blob, strength: number): Promise<Blob> {
    this.cleaned.push({ strength });
    return Promise.resolve(new Blob([PNG.slice()], { type: 'image/png' }));
  }
}

/** The app's real providers, a fake backend and a fake renderer. Language starts as French. */
export function setup(
  routes: Routes = [],
  providers: Provider[] = [],
): {
  http: HttpTestingController;
  renderer: FakeRenderer;
  raster: FakeRaster;
} {
  localStorage.setItem('language', 'fr');
  const renderer = new FakeRenderer();
  const raster = new FakeRaster();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideI18n({ en, fr }),
      { provide: PdfRenderer, useValue: renderer },
      { provide: Raster, useValue: raster },
      ...providers,
    ],
  });
  return { http: TestBed.inject(HttpTestingController), renderer, raster };
}

/** Answers the session check made at startup. */
export function flushMe(http: HttpTestingController, user: User | null = USER): void {
  const req = http.expectOne('/api/auth/me');
  if (user) req.flush(user);
  else req.flush(null, { status: 401, statusText: 'Unauthorized' });
}

/** The header's switch: saved on the account, since the user's language wins. */
export async function switchToEnglish(http: HttpTestingController): Promise<void> {
  const change = TestBed.inject(LanguageService).change('en');
  http
    .expectOne({ method: 'PATCH', url: '/api/auth/me/language' })
    .flush({ ...USER, language: 'en' });
  await change;
}

/**
 * A PDF of `sizes.length` pages; page i is sizes[i] points (A4 by default),
 * so specs can tell pages apart by size after they're moved.
 */
export async function makePdf(sizes: [number, number][] = [PageSizes.A4]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const size of sizes) doc.addPage(size);
  return doc.save();
}

/** `count` pages of widths 101, 102, … (height 500). */
export const numbered = (count: number, from = 1): Promise<Uint8Array> =>
  makePdf(Array.from({ length: count }, (_, i) => [100 + from + i, 500] as [number, number]));

/** Each page's width and rotation, in order. */
export async function describePdf(bytes: Uint8Array): Promise<{ width: number; rotate: number }[]> {
  const doc = await PDFDocument.load(bytes);
  return doc
    .getPages()
    .map((p) => ({ width: Math.round(p.getWidth()), rotate: p.getRotation().angle }));
}

export function fileOf(bytes: Uint8Array | string, name: string, type = 'application/pdf'): File {
  return new File([typeof bytes === 'string' ? bytes : bytes.slice()], name, { type });
}

/** A 2×1 red PNG. */
export const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4z8AARAAI/gH/xp559wAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

/** Catches `downloadBlob`: what was downloaded, by file name. */
export function catchDownloads(): { name: string; blob: Blob }[] {
  const downloads: { name: string; blob: Blob }[] = [];
  let last: Blob | undefined;
  Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => {
      last = blob;
      return 'blob:fake';
    }),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ name: this.download, blob: last! });
  });
  return downloads;
}

export async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export async function unzip(blob: Blob): Promise<Record<string, Uint8Array>> {
  return unzipSync(await bytesOf(blob));
}

/** Waits for pending promises (file reads, pdf-lib) and re-renders. */
export async function settle<T>(fixture: ComponentFixture<T>, rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }
}

export function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Picks `files` in the page's first file input, as the browser would. */
export function pick(root: HTMLElement, files: File[]): void {
  const input = root.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change'));
}

export function click(root: HTMLElement, selectorOrText: string): void {
  const byText = [...root.querySelectorAll<HTMLElement>('button, a, label')].find(
    (el) => text(el) === selectorOrText || el.getAttribute('aria-label') === selectorOrText,
  );
  const el = byText ?? root.querySelector<HTMLElement>(selectorOrText);
  if (!el) throw new Error(`nothing to click: ${selectorOrText}`);
  el.click();
}
