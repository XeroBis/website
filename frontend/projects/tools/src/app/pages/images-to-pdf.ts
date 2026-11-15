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

import { ImageType, blobOf, imageType, readBytes } from '../pdf/files';
import {
  ImageError,
  ImageLayoutOptions,
  Margin,
  Orientation,
  PageSize,
  imageLayout,
  imagesToPdf,
} from '../pdf/ops';
import { Skipped, newId } from '../pdf/sources';
import { FileButton, FileDrop, SkippedNotice } from '../ui/files';
import { Job } from '../ui/job';
import { PluralPipe } from '../ui/plural';

interface PickedImage {
  id: string;
  name: string;
  type: ImageType;
  bytes: Uint8Array;
  /** Object URL of the file, for its tile. */
  url: string;
  /** Natural size, once the tile's <img> has loaded. */
  width?: number;
  height?: number;
}

/** The preview box, in CSS pixels. */
const PREVIEW = { width: 220, height: 200 };

@Component({
  selector: 'ab-images-to-pdf',
  imports: [
    CdkDrag,
    CdkDropList,
    FileButton,
    FileDrop,
    Icon,
    PluralPipe,
    SkippedNotice,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './images-to-pdf.html',
})
export class ImagesToPdf {
  protected readonly images = signal<PickedImage[]>([]);
  protected readonly skipped = signal<Skipped[]>([]);
  protected readonly job = new Job();

  protected readonly size = signal<PageSize>('a4');
  protected readonly orientation = signal<Orientation>('auto');
  protected readonly margin = signal<Margin>('small');
  protected readonly sizes: PageSize[] = ['a4', 'letter', 'fit'];
  protected readonly orientations: Orientation[] = ['auto', 'portrait', 'landscape'];
  protected readonly margins: Margin[] = ['none', 'small', 'large'];

  private readonly options = computed((): ImageLayoutOptions => ({
    size: this.size(),
    orientation: this.orientation(),
    margin: this.size() === 'fit' ? 'none' : this.margin(),
  }));

  /** Page 1 drawn to scale inside the preview box (an unloaded image counts as 4:3). */
  protected readonly preview = computed(() => {
    const first = this.images()[0];
    const at = imageLayout(first?.width ?? 400, first?.height ?? 300, this.options());
    const scale = Math.min(PREVIEW.width / at.pageWidth, PREVIEW.height / at.pageHeight);
    return {
      url: first?.url,
      page: { width: at.pageWidth * scale, height: at.pageHeight * scale },
      image: {
        left: at.x * scale,
        top: at.y * scale,
        width: at.width * scale,
        height: at.height * scale,
      },
    };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.images().forEach((i) => URL.revokeObjectURL(i.url)));
  }

  protected async add(files: File[]): Promise<void> {
    const added: PickedImage[] = [];
    const skipped: Skipped[] = [];
    for (const file of files) {
      const type = imageType(file);
      if (!type) {
        skipped.push({ name: file.name, reason: 'notImage' });
        continue;
      }
      const bytes = await readBytes(file);
      added.push({ id: newId(), name: file.name, type, bytes, url: URL.createObjectURL(file) });
    }
    this.skipped.set(skipped);
    this.job.error.set(null);
    this.images.update((all) => [...all, ...added]);
  }

  protected loaded(image: PickedImage, event: Event): void {
    const img = event.target as HTMLImageElement;
    this.images.update((all) =>
      all.map((i) =>
        i === image ? { ...i, width: img.naturalWidth, height: img.naturalHeight } : i,
      ),
    );
  }

  /** The browser can't show it: it won't embed either. */
  protected broken(image: PickedImage): void {
    this.remove(image);
    this.skipped.update((s) => [...s, { name: image.name, reason: 'invalid' }]);
  }

  protected remove(image: PickedImage): void {
    URL.revokeObjectURL(image.url);
    this.images.update((all) => all.filter((i) => i !== image));
  }

  protected drop(event: CdkDragDrop<unknown>): void {
    const images = [...this.images()];
    moveItemInArray(images, event.previousIndex, event.currentIndex);
    this.images.set(images);
  }

  protected create(): Promise<void> {
    const images = this.images();
    return this.job.run(async () => {
      try {
        const bytes = await imagesToPdf(images, this.options());
        downloadBlob(blobOf(bytes, 'application/pdf'), 'images.pdf');
      } catch (e) {
        if (!(e instanceof ImageError)) throw e;
        this.broken(images[e.index]);
      }
    });
  }
}
