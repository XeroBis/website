import { DestroyRef, inject, signal } from '@angular/core';

import { isPdf } from '../pdf/files';
import { PdfRenderer } from '../pdf/renderer';
import { PdfSource, Skipped, readPdfs } from '../pdf/sources';
import { Job } from '../ui/job';

/** The tools that work on one PDF at a time: a new file replaces the last. */
export abstract class SinglePdfTool {
  protected readonly renderer = inject(PdfRenderer);
  protected readonly source = signal<PdfSource | null>(null);
  protected readonly skipped = signal<Skipped[]>([]);
  protected readonly job = new Job();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.release());
  }

  protected async open(files: File[]): Promise<void> {
    // One PDF: the first one. Other PDFs dropped with it are ignored, non-PDFs reported.
    const notPdf: Skipped[] = files
      .filter((f) => !isPdf(f))
      .map((f) => ({ name: f.name, reason: 'notPdf' }));
    const first = files.find(isPdf);
    const { sources, skipped } = first ? await readPdfs([first]) : { sources: [], skipped: [] };
    this.skipped.set([...skipped, ...notPdf]);
    const source = sources[0];
    if (!source) return;
    this.release();
    this.job.error.set(null);
    this.source.set(source);
    this.opened(source);
  }

  /** Resets the tool's state for a newly opened file. */
  protected abstract opened(source: PdfSource): void;

  private release(): void {
    const source = this.source();
    if (source) this.renderer.release(source.bytes);
  }
}
