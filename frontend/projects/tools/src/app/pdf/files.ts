import { zipSync } from 'fflate';

/** `report.final.pdf` → `report.final`. */
export function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Makes `name` safe as a download name and ends it with `.ext`. */
export function withExtension(name: string, ext: string): string {
  const clean = name.trim().replace(/[\\/:*?"<>|]+/g, '-') || 'document';
  return clean.toLowerCase().endsWith(`.${ext}`) ? clean : `${clean}.${ext}`;
}

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export type ImageType = 'jpg' | 'png';

export function imageType(file: File): ImageType | null {
  if (file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)) return 'jpg';
  if (file.type === 'image/png' || /\.png$/i.test(file.name)) return 'png';
  return null;
}

export async function readBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * A zip of `files` (name → content). Stored, not compressed: PDFs, PNGs and
 * JPGs are already compressed, so deflating them again costs time for nothing.
 */
export function zip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files, { level: 0 });
}

/** A Blob of `bytes`, copied so pdf-lib's buffer type never leaks into the DOM API. */
export function blobOf(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes.slice()], { type });
}
