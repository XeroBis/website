import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';

import { PdfRenderer } from '../pdf/renderer';

/** Thumbnail width in CSS pixels (the tray's columns are about this wide). */
const WIDTH = 160;

/**
 * One PDF page, drawn by pdf.js once it nears the viewport (and again if
 * the file or page changes), inside a square slot so a page turned by
 * `rotate` still fits.
 */
@Component({
  selector: 'ab-page-thumb',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'thumb' },
  template: `
    @if (src(); as src) {
      <img [src]="src" alt="" draggable="false" [style.transform]="'rotate(' + rotate() + 'deg)'" />
    } @else {
      <span class="thumb-blank" [class.failed]="failed()"></span>
    }
  `,
})
export class PageThumb {
  readonly bytes = input.required<Uint8Array>();
  /** 0-based. */
  readonly index = input.required<number>();
  /** Degrees clockwise. */
  readonly rotate = input(0);

  private readonly renderer = inject(PdfRenderer);
  protected readonly src = signal<string | null>(null);
  protected readonly failed = signal(false);
  private readonly visible = signal(false);
  /** Bumped per draw, so a slow earlier draw never replaces a newer one. */
  private drawn = 0;

  constructor() {
    const el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    let observer: IntersectionObserver | undefined;
    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') return this.visible.set(true);
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            observer?.disconnect();
            this.visible.set(true);
          }
        },
        { rootMargin: '400px' },
      );
      observer.observe(el);
    });
    effect(() => {
      if (!this.visible()) return;
      const bytes = this.bytes();
      const index = this.index();
      untracked(() => void this.draw(bytes, index));
    });
    inject(DestroyRef).onDestroy(() => {
      this.drawn++;
      observer?.disconnect();
      this.show(null);
    });
  }

  private async draw(bytes: Uint8Array, index: number): Promise<void> {
    const ticket = ++this.drawn;
    this.failed.set(false);
    try {
      const blob = await this.renderer.thumbnail(bytes, index, WIDTH);
      if (ticket === this.drawn) this.show(URL.createObjectURL(blob));
    } catch {
      if (ticket === this.drawn) this.failed.set(true);
    }
  }

  private show(src: string | null): void {
    const old = this.src();
    if (old) URL.revokeObjectURL(old);
    this.src.set(src);
  }
}
