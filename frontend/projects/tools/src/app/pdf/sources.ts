import { isPdf, readBytes } from './files';
import { PdfError, pageCount } from './ops';

/** A PDF opened in a tool. `bytes` is never modified: it also keys pdf.js' cache. */
export interface PdfSource {
  id: string;
  name: string;
  bytes: Uint8Array;
  pages: number;
}

/** A file a tool didn't take, and why (`error.<reason>` in the i18n files). */
export interface Skipped {
  name: string;
  reason: 'notPdf' | 'notImage' | 'encrypted' | 'invalid';
}

let nextId = 0;
export const newId = () => `f${++nextId}`;

/** Reads the PDFs among `files`; the others, and unreadable PDFs, are skipped. */
export async function readPdfs(
  files: readonly File[],
): Promise<{ sources: PdfSource[]; skipped: Skipped[] }> {
  const sources: PdfSource[] = [];
  const skipped: Skipped[] = [];
  for (const file of files) {
    if (!isPdf(file)) {
      skipped.push({ name: file.name, reason: 'notPdf' });
      continue;
    }
    const bytes = await readBytes(file);
    try {
      sources.push({ id: newId(), name: file.name, bytes, pages: await pageCount(bytes) });
    } catch (e) {
      skipped.push({ name: file.name, reason: e instanceof PdfError ? e.reason : 'invalid' });
    }
  }
  return { sources, skipped };
}
