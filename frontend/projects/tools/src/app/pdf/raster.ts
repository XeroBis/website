import { Injectable } from '@angular/core';

/** Longest side of a cleaned image: plenty for a signature, small enough to embed. */
const MAX_SIDE = 2000;

/** How far from white (0–255, by the darkest channel) the soft edge spans. */
const EDGE = 40;

/**
 * Makes near-white pixels transparent, in place (RGBA). `strength` 0–100:
 * a pixel within `strength × 1.5` of white goes fully transparent, the next
 * `EDGE` levels fade, so strokes keep smooth edges.
 */
export function clearWhitePixels(px: Uint8ClampedArray, strength: number): void {
  const clear = strength * 1.5;
  const keep = clear + EDGE;
  for (let i = 0; i < px.length; i += 4) {
    const distance = 255 - Math.min(px[i], px[i + 1], px[i + 2]);
    if (distance >= keep) continue;
    px[i + 3] = distance <= clear ? 0 : Math.round((px[i + 3] * (distance - clear)) / EDGE);
  }
}

export function canvasBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))), type),
  );
}

/** Image decoding and pixel work, with a canvas. Tests provide a fake. */
@Injectable({ providedIn: 'root' })
export class Raster {
  /** The image's size in pixels, or null if the browser can't decode it. */
  async size(blob: Blob): Promise<{ width: number; height: number } | null> {
    try {
      const bitmap = await createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      return null;
    }
  }

  /** A PNG of `blob` (shrunk to `MAX_SIDE`) with its white background made transparent. */
  async clearWhite(blob: Blob, strength: number): Promise<Blob> {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    clearWhitePixels(pixels.data, strength);
    ctx.putImageData(pixels, 0, 0);
    try {
      return await canvasBlob(canvas);
    } finally {
      canvas.width = canvas.height = 0;
    }
  }
}
