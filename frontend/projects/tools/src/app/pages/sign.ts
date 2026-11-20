import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { Icon, downloadBlob } from '@shared';

import { ImageType, baseName, blobOf, imageType, isPdf, readBytes } from '../pdf/files';
import { ImageInput, PageBox, pageBoxes, stampPdf } from '../pdf/ops';
import { Raster } from '../pdf/raster';
import { PdfSource, Skipped, newId } from '../pdf/sources';
import { FileHead } from '../ui/file-head';
import { FileButton, FileDrop, SkippedNotice } from '../ui/files';
import { PageThumb } from '../ui/page-thumb';
import { PluralPipe } from '../ui/plural';
import { SignaturePad } from '../ui/signature-pad';
import { SinglePdfTool } from './single-pdf';

/** An image ready to place: uploaded, or drawn on the pad. */
interface StampImage {
  id: string;
  name: string;
  /** The file as picked or drawn. */
  original: Blob;
  originalType: ImageType;
  drawn: boolean;
  /** Pixel size (after cleaning, which may shrink it): only the ratio matters. */
  width: number;
  height: number;
  /** "Remove white background", and how much counts as white (0–100). */
  clearWhite: boolean;
  strength: number;
  /** What gets embedded and shown: the original, or the cleaned PNG. */
  bytes: Uint8Array;
  type: ImageType;
  url: string;
}

/** An image on a page: position and width as fractions of the page as shown. */
interface PlacedStamp {
  id: string;
  image: string;
  page: number;
  x: number;
  y: number;
  width: number;
}

interface Drag {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  /** The page on screen, in CSS pixels. */
  pageWidth: number;
  pageHeight: number;
  from: PlacedStamp;
}

/** The big page's render width, in CSS pixels. */
const VIEW_WIDTH = 900;
/** A new stamp's width, as a fraction of the page. */
const START_WIDTH = 0.3;
const MIN_WIDTH = 0.02;
const DEFAULT_STRENGTH = 50;

@Component({
  selector: 'ab-sign',
  imports: [
    FileButton,
    FileDrop,
    FileHead,
    Icon,
    PageThumb,
    PluralPipe,
    SignaturePad,
    SkippedNotice,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sign.html',
})
export class Sign extends SinglePdfTool {
  private readonly raster = inject(Raster);

  protected readonly boxes = signal<PageBox[]>([]);
  protected readonly current = signal(0);
  protected readonly images = signal<StampImage[]>([]);
  protected readonly stamps = signal<PlacedStamp[]>([]);
  protected readonly selected = signal<string | null>(null);
  protected readonly drawing = signal(false);
  /** The current page, drawn large. */
  protected readonly pageUrl = signal<string | null>(null);
  private drag: Drag | null = null;
  private rendered = 0;
  /** By image id, the latest cleaning asked for. */
  private readonly processing = new Map<string, number>();

  protected readonly pageIndices = computed(() =>
    Array.from({ length: this.source()?.pages ?? 0 }, (_, i) => i),
  );

  protected readonly box = computed(() => this.boxes()[this.current()] ?? null);

  /** The current page's stamps, with their height and image. */
  protected readonly shown = computed(() => {
    const images = new Map(this.images().map((i) => [i.id, i]));
    return this.stamps()
      .filter((s) => s.page === this.current())
      .map((s) => ({ ...s, height: this.heightOf(s), url: images.get(s.image)!.url }));
  });

  protected readonly perPage = computed(() => {
    const counts = new Map<number, number>();
    for (const s of this.stamps()) counts.set(s.page, (counts.get(s.page) ?? 0) + 1);
    return counts;
  });

  protected readonly selectedStamp = computed(
    () => this.stamps().find((s) => s.id === this.selected()) ?? null,
  );

  constructor() {
    super();
    effect(() => {
      const source = this.source();
      const index = this.current();
      untracked(() => void this.renderPage(source, index));
    });
    inject(DestroyRef).onDestroy(() => {
      this.rendered++;
      this.showPage(null);
      this.images().forEach((i) => URL.revokeObjectURL(i.url));
    });
  }

  protected opened(source: PdfSource): void {
    this.stamps.set([]);
    this.selected.set(null);
    this.current.set(0);
    this.boxes.set([]);
    void pageBoxes(source.bytes).then((boxes) => {
      if (this.source() === source) this.boxes.set(boxes);
    });
  }

  /** PDFs open, images join the list: either can be dropped on the page. */
  protected async dropped(files: File[]): Promise<void> {
    const pdfs = files.filter(isPdf);
    const others = files.filter((f) => !isPdf(f));
    if (pdfs.length) await this.open(pdfs);
    if (others.length || !pdfs.length) await this.addImages(others, pdfs.length > 0);
  }

  // The page view.

  private async renderPage(source: PdfSource | null, index: number): Promise<void> {
    const ticket = ++this.rendered;
    this.showPage(null);
    if (!source) return;
    try {
      const blob = await this.renderer.thumbnail(source.bytes, index, VIEW_WIDTH);
      if (ticket === this.rendered) this.showPage(URL.createObjectURL(blob));
    } catch {
      // The page stays blank; saving still works.
    }
  }

  private showPage(url: string | null): void {
    const old = this.pageUrl();
    if (old) URL.revokeObjectURL(old);
    this.pageUrl.set(url);
  }

  protected goTo(index: number): void {
    const count = this.source()?.pages ?? 0;
    if (index < 0 || index >= count) return;
    this.current.set(index);
    this.selected.set(null);
  }

  // Images.

  protected async addImages(files: File[], append = false): Promise<void> {
    const skipped: Skipped[] = [];
    const added: StampImage[] = [];
    for (const file of files) {
      const type = imageType(file);
      if (!type) {
        skipped.push({ name: file.name, reason: 'notImage' });
        continue;
      }
      const image = await this.prepare(file, type, file.name, false);
      if (image) added.push(image);
      else skipped.push({ name: file.name, reason: 'invalid' });
    }
    this.skipped.update((s) => (append ? [...s, ...skipped] : skipped));
    this.images.update((all) => [...all, ...added]);
  }

  protected async addDrawing(blob: Blob): Promise<void> {
    this.drawing.set(false);
    const n = this.images().filter((i) => i.drawn).length + 1;
    const image = await this.prepare(blob, 'png', `signature-${n}.png`, true);
    if (!image) return;
    this.images.update((all) => [...all, image]);
    if (this.source()) this.place(image);
  }

  /** Reads an image (null if the browser can't decode it), cleaned if it's a JPG. */
  private async prepare(
    original: Blob,
    type: ImageType,
    name: string,
    drawn: boolean,
  ): Promise<StampImage | null> {
    const size = await this.raster.size(original);
    if (!size) return null;
    const image: StampImage = {
      id: newId(),
      name,
      original,
      originalType: type,
      drawn,
      ...size,
      clearWhite: !drawn && type === 'jpg',
      strength: DEFAULT_STRENGTH,
      bytes: new Uint8Array(),
      type,
      url: '',
    };
    return this.process(image);
  }

  /** Builds what gets embedded: the original, or a PNG without its white background. */
  private async process(image: StampImage): Promise<StampImage | null> {
    try {
      const blob = image.clearWhite
        ? await this.raster.clearWhite(image.original, image.strength)
        : image.original;
      const size = image.clearWhite ? await this.raster.size(blob) : null;
      return {
        ...image,
        ...(size ?? {}),
        bytes: await readBytes(blob),
        type: image.clearWhite ? 'png' : image.originalType,
        url: URL.createObjectURL(blob),
      };
    } catch {
      return null;
    }
  }

  private async reprocess(image: StampImage, change: Partial<StampImage>): Promise<void> {
    // The settings show at once; only the last of several quick changes lands.
    const ticket = (this.processing.get(image.id) ?? 0) + 1;
    this.processing.set(image.id, ticket);
    this.images.update((all) => all.map((i) => (i.id === image.id ? { ...i, ...change } : i)));
    const latest = this.images().find((i) => i.id === image.id);
    const next = latest && (await this.process(latest));
    if (!next) return;
    if (this.processing.get(image.id) !== ticket || !this.images().some((i) => i.id === image.id)) {
      URL.revokeObjectURL(next.url);
      return;
    }
    this.images.update((all) =>
      all.map((i) => {
        if (i.id !== image.id) return i;
        URL.revokeObjectURL(i.url);
        return next;
      }),
    );
  }

  protected setClearWhite(image: StampImage, on: boolean): Promise<void> {
    return this.reprocess(image, { clearWhite: on });
  }

  protected setStrength(image: StampImage, event: Event): Promise<void> {
    return this.reprocess(image, { strength: +(event.target as HTMLInputElement).value });
  }

  protected removeImage(image: StampImage): void {
    URL.revokeObjectURL(image.url);
    this.images.update((all) => all.filter((i) => i.id !== image.id));
    this.stamps.update((all) => all.filter((s) => s.image !== image.id));
    if (!this.selectedStamp()) this.selected.set(null);
  }

  // Stamps.

  /** The stamp's height as a fraction of its page, from its image's ratio. */
  private heightOf(s: { image: string; page: number; width: number }): number {
    const image = this.images().find((i) => i.id === s.image);
    const box = this.boxes()[s.page];
    if (!image || !box) return s.width;
    return (s.width * box.width * image.height) / (image.width * box.height);
  }

  /** Keeps the stamp on its page: not too small, not taller than the page, inside it. */
  private fit(s: PlacedStamp): PlacedStamp {
    let width = Math.min(Math.max(s.width, MIN_WIDTH), 1);
    const ratio = this.heightOf({ ...s, width: 1 });
    if (width * ratio > 1) width = 1 / ratio;
    const height = width * ratio;
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(max, 0));
    return { ...s, width, x: clamp(s.x, 1 - width), y: clamp(s.y, 1 - height) };
  }

  /** Drops `image` in the middle of the current page, selected. */
  protected place(image: StampImage): void {
    const page = this.current();
    const s = this.fit({ id: newId(), image: image.id, page, x: 0, y: 0, width: START_WIDTH });
    const height = this.heightOf(s);
    const centred = this.fit({ ...s, x: (1 - s.width) / 2, y: (1 - height) / 2 });
    this.stamps.update((all) => [...all, centred]);
    this.selected.set(centred.id);
  }

  private update(id: string, change: (s: PlacedStamp) => Partial<PlacedStamp>): void {
    this.stamps.update((all) =>
      all.map((s) => (s.id === id ? this.fit({ ...s, ...change(s) }) : s)),
    );
  }

  protected removeStamp(id: string): void {
    this.stamps.update((all) => all.filter((s) => s.id !== id));
    if (this.selected() === id) this.selected.set(null);
  }

  /** Copies the stamp, at the same spot, onto every other page. */
  protected copyToAll(stamp: PlacedStamp): void {
    const count = this.source()?.pages ?? 0;
    const copies: PlacedStamp[] = [];
    for (let page = 0; page < count; page++) {
      if (page !== stamp.page) copies.push(this.fit({ ...stamp, id: newId(), page }));
    }
    this.stamps.update((all) => [...all, ...copies]);
  }

  protected grab(event: PointerEvent, stamp: PlacedStamp, mode: Drag['mode']): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const el = event.currentTarget as HTMLElement;
    const page = el.closest<HTMLElement>('.sign-page')!.getBoundingClientRect();
    el.setPointerCapture?.(event.pointerId);
    el.closest<HTMLElement>('.stamp')?.focus({ preventScroll: true });
    this.selected.set(stamp.id);
    this.drag = {
      id: stamp.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      pageWidth: page.width,
      pageHeight: page.height,
      from: stamp,
    };
  }

  protected dragTo(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || !drag.pageWidth || !drag.pageHeight) return;
    const dx = (event.clientX - drag.startX) / drag.pageWidth;
    const dy = (event.clientY - drag.startY) / drag.pageHeight;
    const { from } = drag;
    if (drag.mode === 'move') {
      this.update(drag.id, () => ({ x: from.x + dx, y: from.y + dy }));
    } else {
      // The corner follows whichever way the pointer went further; the ratio is kept.
      const ratio = this.heightOf({ ...from, width: 1 });
      const width = Math.max(from.width + dx, from.width + dy / ratio);
      this.update(drag.id, () => ({ width: Math.min(width, 1 - from.x) }));
    }
  }

  protected letGo(): void {
    this.drag = null;
  }

  /** Arrows move (Shift: further), + and − resize, Delete removes. */
  protected key(event: KeyboardEvent, stamp: PlacedStamp): void {
    const step = event.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move) {
      this.update(stamp.id, (s) => ({ x: s.x + move[0], y: s.y + move[1] }));
    } else if (event.key === '+' || event.key === '=') {
      this.update(stamp.id, (s) => ({ width: s.width * 1.1 }));
    } else if (event.key === '-') {
      this.update(stamp.id, (s) => ({ width: s.width / 1.1 }));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      this.removeStamp(stamp.id);
    } else {
      return;
    }
    event.preventDefault();
    this.selected.set(stamp.id);
  }

  // Saving.

  protected readonly pagesUsed = computed(() => this.perPage().size);

  protected save(source: PdfSource): Promise<void> {
    return this.job.run(async () => {
      const images: Record<string, ImageInput> = {};
      for (const i of this.images()) images[i.id] = { bytes: i.bytes, type: i.type };
      const stamps = this.stamps().map((s) => ({ ...s, height: this.heightOf(s) }));
      const bytes = await stampPdf(source.bytes, images, stamps);
      downloadBlob(blobOf(bytes, 'application/pdf'), `${baseName(source.name)}-signed.pdf`);
    });
  }
}
