import { InjectionToken } from '@angular/core';

import { normalizeIsbn } from './isbn';

/** The part of the `BarcodeDetector` API the scanner uses. */
export interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

interface DetectorClass {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

/** Where the build copies ZXing's decoder (see angular.json). */
const WASM_DIR = '/zxing/';

/**
 * An EAN-13 reader: the browser's own `BarcodeDetector` where it has one
 * (Chrome on Android), else ZXing compiled to WebAssembly, served by media
 * itself. Loaded on the first scan only.
 */
export async function loadDetector(): Promise<Detector> {
  const native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (native && (await native.getSupportedFormats().catch((): string[] => [])).includes('ean_13')) {
    return new native({ formats: ['ean_13'] });
  }
  const { BarcodeDetector, setZXingModuleOverrides } = await import('barcode-detector/ponyfill');
  setZXingModuleOverrides({
    locateFile: (path: string, prefix: string) =>
      path.endsWith('.wasm') ? WASM_DIR + path : prefix + path,
  });
  return new BarcodeDetector({ formats: ['ean_13'] });
}

/** How the scanner gets its reader (replaced in specs). */
export const DETECTOR_LOADER = new InjectionToken<() => Promise<Detector>>('DETECTOR_LOADER', {
  factory: () => loadDetector,
});

/** The ISBN in a book's EAN-13 barcode (it starts with 978 or 979), else null. */
export function isbnFromBarcode(raw: string): string | null {
  return /^97[89]\d{10}$/.test(raw) ? normalizeIsbn(raw) : null;
}

/** Whether the browser can open a camera (it needs HTTPS or localhost). */
export function canScan(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}
