import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon, downloadBlob } from '@shared';

import { baseName, blobOf, zip } from '../pdf/files';
import { assemble, split } from '../pdf/ops';
import { PageRange, formatRanges, parseRanges, toRanges } from '../pdf/ranges';
import { PdfSource } from '../pdf/sources';
import { FileHead } from '../ui/file-head';
import { FileButton, FileDrop, SkippedNotice } from '../ui/files';
import { PageThumb } from '../ui/page-thumb';
import { PluralPipe } from '../ui/plural';
import { SinglePdfTool } from './single-pdf';

type Mode = 'one' | 'perRange';

const label = ([from, to]: PageRange) => (from === to ? `${from}` : `${from}-${to}`);

@Component({
  selector: 'ab-extract',
  imports: [
    FileButton,
    FileDrop,
    FileHead,
    Icon,
    PageThumb,
    PluralPipe,
    SkippedNotice,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './extract.html',
})
export class Extract extends SinglePdfTool {
  /** The ranges field: the selection's source of truth. */
  protected readonly text = signal('');
  protected readonly mode = signal<Mode>('one');
  protected readonly modes: Mode[] = ['one', 'perRange'];
  protected readonly parsed = computed(() => parseRanges(this.text(), this.source()?.pages ?? 0));
  protected readonly selected = computed(() => new Set(this.parsed().pages));
  /** Each range once, so the zip never has two files of the same name. */
  private readonly ranges = computed(() => {
    const seen = new Set<string>();
    return this.parsed().ranges.filter((r) => !seen.has(label(r)) && !!seen.add(label(r)));
  });
  protected readonly outputs = computed(() => (this.mode() === 'one' ? 1 : this.ranges().length));
  protected readonly numbers = computed(() =>
    Array.from({ length: this.source()?.pages ?? 0 }, (_, i) => i + 1),
  );

  protected opened(): void {
    this.text.set('');
  }

  protected toggle(page: number): void {
    const pages = new Set(this.selected());
    if (pages.has(page)) pages.delete(page);
    else pages.add(page);
    this.text.set(formatRanges(toRanges(pages)));
  }

  protected all(): void {
    this.text.set(formatRanges(toRanges(this.numbers())));
  }

  protected run(source: PdfSource): Promise<void> {
    return this.job.run(async () => {
      const base = baseName(source.name);
      if (this.mode() === 'one') {
        const picks = this.parsed().pages.map((p) => ({ source: 'src', index: p - 1 }));
        const bytes = await assemble({ src: source.bytes }, picks);
        return downloadBlob(blobOf(bytes, 'application/pdf'), `${base}-pages.pdf`);
      }
      const ranges = this.ranges();
      const pdfs = await split(source.bytes, ranges);
      if (pdfs.length === 1) {
        return downloadBlob(blobOf(pdfs[0], 'application/pdf'), `${base}-${label(ranges[0])}.pdf`);
      }
      const files = Object.fromEntries(
        pdfs.map((pdf, i) => [`${base}-${label(ranges[i])}.pdf`, pdf]),
      );
      downloadBlob(blobOf(zip(files), 'application/zip'), `${base}-split.zip`);
    });
  }
}
