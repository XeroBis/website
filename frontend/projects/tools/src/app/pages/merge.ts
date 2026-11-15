import { CdkDrag, CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon, downloadBlob } from '@shared';

import { blobOf, withExtension } from '../pdf/files';
import { assemble } from '../pdf/ops';
import { PdfRenderer } from '../pdf/renderer';
import { PdfSource, Skipped, newId, readPdfs } from '../pdf/sources';
import { FileButton, FileDrop, SkippedNotice } from '../ui/files';
import { Job } from '../ui/job';
import { PageThumb } from '../ui/page-thumb';
import { PluralPipe } from '../ui/plural';

/** File tags, in order of adding (then round again). */
const COLORS = ['#2b56e0', '#d9731a', '#138a7e', '#7c4dce', '#c2305a', '#8a7400'];

interface MergeFile extends PdfSource {
  color: string;
}

interface MergePage {
  key: string;
  source: string;
  index: number;
}

@Component({
  selector: 'ab-merge',
  imports: [
    CdkDrag,
    CdkDropList,
    FileButton,
    FileDrop,
    Icon,
    PageThumb,
    PluralPipe,
    SkippedNotice,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './merge.html',
})
export class Merge {
  private readonly renderer = inject(PdfRenderer);

  protected readonly files = signal<MergeFile[]>([]);
  protected readonly pages = signal<MergePage[]>([]);
  protected readonly name = signal('merged.pdf');
  protected readonly skipped = signal<Skipped[]>([]);
  protected readonly job = new Job();
  protected readonly byId = computed(() => new Map(this.files().map((f) => [f.id, f])));
  private added = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.files().forEach((f) => this.renderer.release(f.bytes)));
  }

  protected async add(list: File[]): Promise<void> {
    const { sources, skipped } = await readPdfs(list);
    this.skipped.set(skipped);
    const files = sources.map((s) => ({ ...s, color: COLORS[this.added++ % COLORS.length] }));
    this.files.update((all) => [...all, ...files]);
    this.pages.update((all) => [
      ...all,
      ...files.flatMap((f) =>
        Array.from({ length: f.pages }, (_, index) => ({ key: newId(), source: f.id, index })),
      ),
    ]);
  }

  protected removeFile(file: MergeFile): void {
    this.files.update((all) => all.filter((f) => f !== file));
    this.pages.update((all) => all.filter((p) => p.source !== file.id));
    this.renderer.release(file.bytes);
  }

  protected removePage(page: MergePage): void {
    this.pages.update((all) => all.filter((p) => p !== page));
  }

  /** Moving a file moves its pages as a block; each file's own page order stays. */
  protected dropFile(event: CdkDragDrop<unknown>): void {
    const files = [...this.files()];
    moveItemInArray(files, event.previousIndex, event.currentIndex);
    this.files.set(files);
    const rank = new Map(files.map((f, i) => [f.id, i]));
    this.pages.update((all) => [...all].sort((a, b) => rank.get(a.source)! - rank.get(b.source)!));
  }

  protected dropPage(event: CdkDragDrop<unknown>): void {
    const pages = [...this.pages()];
    moveItemInArray(pages, event.previousIndex, event.currentIndex);
    this.pages.set(pages);
  }

  protected merge(): Promise<void> {
    return this.job.run(async () => {
      const sources = Object.fromEntries(this.files().map((f) => [f.id, f.bytes]));
      const picks = this.pages().map((p) => ({ source: p.source, index: p.index }));
      const bytes = await assemble(sources, picks);
      downloadBlob(blobOf(bytes, 'application/pdf'), withExtension(this.name(), 'pdf'));
    });
  }
}
