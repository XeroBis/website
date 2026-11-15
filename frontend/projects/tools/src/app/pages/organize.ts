import { CdkDrag, CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon, downloadBlob } from '@shared';

import { baseName, blobOf } from '../pdf/files';
import { assemble } from '../pdf/ops';
import { PdfSource } from '../pdf/sources';
import { FileHead } from '../ui/file-head';
import { FileButton, FileDrop, SkippedNotice } from '../ui/files';
import { PageThumb } from '../ui/page-thumb';
import { PluralPipe } from '../ui/plural';
import { SinglePdfTool } from './single-pdf';

interface OrganizePage {
  /** 0-based, in the source. */
  index: number;
  /** Degrees clockwise added, any multiple of 90 (kept unbounded so the turn animates the short way). */
  rotate: number;
  deleted: boolean;
}

const fresh = (count: number): OrganizePage[] =>
  Array.from({ length: count }, (_, index) => ({ index, rotate: 0, deleted: false }));

const turned = (p: OrganizePage) => ((p.rotate % 360) + 360) % 360 !== 0;

@Component({
  selector: 'ab-organize',
  imports: [
    CdkDrag,
    CdkDropList,
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
  templateUrl: './organize.html',
})
export class Organize extends SinglePdfTool {
  protected readonly pages = signal<OrganizePage[]>([]);
  protected readonly kept = computed(() => this.pages().filter((p) => !p.deleted).length);
  protected readonly rotated = computed(
    () => this.pages().filter((p) => !p.deleted && turned(p)).length,
  );
  protected readonly removed = computed(() => this.pages().filter((p) => p.deleted).length);
  protected readonly changed = computed(() =>
    this.pages().some((p, i) => p.index !== i || p.deleted || turned(p)),
  );

  protected opened(source: PdfSource): void {
    this.pages.set(fresh(source.pages));
  }

  /** By source index, the page's identity (the object is replaced on every change). */
  private patch(page: OrganizePage, change: (p: OrganizePage) => Partial<OrganizePage>): void {
    this.pages.update((all) =>
      all.map((p) => (p.index === page.index ? { ...p, ...change(p) } : p)),
    );
  }

  protected turn(page: OrganizePage, by: number): void {
    this.patch(page, (p) => ({ rotate: p.rotate + by }));
  }

  protected setDeleted(page: OrganizePage, deleted: boolean): void {
    this.patch(page, () => ({ deleted }));
  }

  protected drop(event: CdkDragDrop<unknown>): void {
    const pages = [...this.pages()];
    moveItemInArray(pages, event.previousIndex, event.currentIndex);
    this.pages.set(pages);
  }

  protected reset(source: PdfSource): void {
    this.pages.set(fresh(source.pages));
  }

  protected save(source: PdfSource): Promise<void> {
    return this.job.run(async () => {
      const picks = this.pages()
        .filter((p) => !p.deleted)
        .map((p) => ({ source: 'src', index: p.index, rotate: p.rotate }));
      const bytes = await assemble({ src: source.bytes }, picks);
      downloadBlob(blobOf(bytes, 'application/pdf'), `${baseName(source.name)}-organized.pdf`);
    });
  }
}
