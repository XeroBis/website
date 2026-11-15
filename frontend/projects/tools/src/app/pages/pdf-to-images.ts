import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon, downloadBlob } from '@shared';

import { baseName, blobOf, readBytes, zip } from '../pdf/files';
import { PdfSource } from '../pdf/sources';
import { FileHead } from '../ui/file-head';
import { FileButton, FileDrop, SkippedNotice } from '../ui/files';
import { PageThumb } from '../ui/page-thumb';
import { SinglePdfTool } from './single-pdf';

type Format = 'png' | 'jpg';

const MIME: Record<Format, string> = { png: 'image/png', jpg: 'image/jpeg' };

@Component({
  selector: 'ab-pdf-to-images',
  imports: [FileButton, FileDrop, FileHead, Icon, PageThumb, SkippedNotice, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pdf-to-images.html',
})
export class PdfToImages extends SinglePdfTool {
  protected readonly selected = signal<ReadonlySet<number>>(new Set());
  protected readonly format = signal<Format>('png');
  protected readonly dpi = signal(150);
  protected readonly quality = signal(85);
  protected readonly formats: Format[] = ['png', 'jpg'];
  protected readonly dpis = [72, 150, 300];
  /** "3 / 8" while exporting. */
  protected readonly progress = signal<{ done: number; total: number } | null>(null);

  protected readonly numbers = computed(() =>
    Array.from({ length: this.source()?.pages ?? 0 }, (_, i) => i + 1),
  );
  protected readonly count = computed(() => this.selected().size);
  protected readonly output = computed(() => {
    const source = this.source();
    if (!source) return '';
    const base = baseName(source.name);
    if (this.count() !== 1) return `${base}-images.zip`;
    return `${base}-p${[...this.selected()][0]}.${this.format()}`;
  });

  protected opened(): void {
    this.selected.set(new Set(this.numbers()));
  }

  protected toggleAll(): void {
    this.selected.set(new Set(this.count() === this.numbers().length ? [] : this.numbers()));
  }

  protected toggle(page: number): void {
    const pages = new Set(this.selected());
    if (pages.has(page)) pages.delete(page);
    else pages.add(page);
    this.selected.set(pages);
  }

  protected run(source: PdfSource): Promise<void> {
    return this.job.run(async () => {
      const pages = [...this.selected()].sort((a, b) => a - b);
      const format = this.format();
      const quality = format === 'jpg' ? this.quality() / 100 : undefined;
      const name = (n: number) => `${baseName(source.name)}-p${n}.${format}`;
      this.progress.set({ done: 0, total: pages.length });
      try {
        const images: Record<string, Uint8Array> = {};
        for (const [i, n] of pages.entries()) {
          const blob = await this.renderer.image(
            source.bytes,
            n - 1,
            this.dpi(),
            MIME[format],
            quality,
          );
          if (pages.length === 1) return downloadBlob(blob, name(n));
          images[name(n)] = await readBytes(blob);
          this.progress.set({ done: i + 1, total: pages.length });
        }
        downloadBlob(blobOf(zip(images), 'application/zip'), this.output());
      } finally {
        this.progress.set(null);
      }
    });
  }
}
