import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { canvasBlob } from '../pdf/raster';

export type Ink = 'black' | 'blue';

const INKS: Record<Ink, string> = { black: '#111111', blue: '#1a3fb0' };
/** Stroke width, in CSS pixels. */
const LINE = 2.5;

type Point = [number, number];

/**
 * A dialog to draw a signature with a mouse, pen or finger. "Use" emits it
 * as a transparent PNG cropped to the strokes.
 */
@Component({
  selector: 'ab-signature-pad',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="pad-backdrop" (click)="closed.emit()">
      <div
        class="pad"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pad-title"
        (click)="$event.stopPropagation()"
      >
        <h2 id="pad-title">{{ 'sign.drawTitle' | translate }}</h2>
        <canvas
          #canvas
          class="pad-canvas"
          [attr.aria-label]="'sign.drawArea' | translate"
          (pointerdown)="start($event)"
          (pointermove)="move($event)"
          (pointerup)="end()"
          (pointercancel)="end()"
        ></canvas>
        <div class="pad-bar">
          <div class="segmented" role="group" [attr.aria-label]="'sign.ink' | translate">
            @for (i of inks; track i) {
              <button type="button" [attr.aria-pressed]="ink() === i" (click)="setInk(i)">
                <span class="ink-dot" [attr.data-ink]="i"></span>
                {{ 'sign.inks.' + i | translate }}
              </button>
            }
          </div>
          <button type="button" class="btn-link" [disabled]="!drawn()" (click)="clear()">
            {{ 'sign.clear' | translate }}
          </button>
          <span class="pad-spacer"></span>
          <button type="button" class="btn-secondary" (click)="closed.emit()">
            {{ 'sign.cancel' | translate }}
          </button>
          <button type="button" class="btn-primary" [disabled]="!drawn()" (click)="use()">
            {{ 'sign.use' | translate }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class SignaturePad {
  readonly done = output<Blob>();
  readonly closed = output<void>();

  protected readonly inks: Ink[] = ['black', 'blue'];
  protected readonly ink = signal<Ink>('black');
  protected readonly drawn = signal(false);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private strokes: Point[][] = [];
  private current: Point[] | null = null;
  private ratio = 1;

  constructor() {
    afterNextRender(() => {
      const canvas = this.canvas().nativeElement;
      this.ratio = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(canvas.clientWidth * this.ratio);
      canvas.height = Math.round(canvas.clientHeight * this.ratio);
    });
  }

  private context(canvas = this.canvas().nativeElement): CanvasRenderingContext2D | null {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.lineWidth = LINE * this.ratio;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ctx.fillStyle = INKS[this.ink()];
    return ctx;
  }

  private point(event: PointerEvent): Point {
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    return [(event.clientX - rect.left) * this.ratio, (event.clientY - rect.top) * this.ratio];
  }

  protected start(event: PointerEvent): void {
    event.preventDefault();
    this.canvas().nativeElement.setPointerCapture?.(event.pointerId);
    this.current = [this.point(event)];
    this.strokes.push(this.current);
    this.drawn.set(true);
    // A dot, in case it's a single tap.
    const ctx = this.context();
    if (!ctx) return;
    const [x, y] = this.current[0];
    ctx.beginPath();
    ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  protected move(event: PointerEvent): void {
    if (!this.current) return;
    const events = event.getCoalescedEvents?.() ?? [event];
    const ctx = this.context();
    for (const e of events.length ? events : [event]) {
      const from = this.current[this.current.length - 1];
      const to = this.point(e);
      this.current.push(to);
      ctx?.beginPath();
      ctx?.moveTo(...from);
      ctx?.lineTo(...to);
      ctx?.stroke();
    }
  }

  protected end(): void {
    this.current = null;
  }

  protected setInk(ink: Ink): void {
    this.ink.set(ink);
    this.redraw(this.canvas().nativeElement);
  }

  protected clear(): void {
    this.strokes = [];
    this.drawn.set(false);
    this.redraw(this.canvas().nativeElement);
  }

  /** Every stroke onto `canvas`, shifted by `-dx, -dy`. */
  private redraw(canvas: HTMLCanvasElement, dx = 0, dy = 0): void {
    const ctx = this.context(canvas);
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of this.strokes) {
      ctx.beginPath();
      if (stroke.length === 1) {
        ctx.arc(stroke[0][0] - dx, stroke[0][1] - dy, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.moveTo(stroke[0][0] - dx, stroke[0][1] - dy);
      for (const [x, y] of stroke.slice(1)) ctx.lineTo(x - dx, y - dy);
      ctx.stroke();
    }
  }

  /** The strokes cropped to their bounds (plus the line's width), as a PNG. */
  protected async use(): Promise<void> {
    const points = this.strokes.flat();
    if (!points.length) return;
    const pad = LINE * this.ratio;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const left = Math.floor(Math.min(...xs) - pad);
    const top = Math.floor(Math.min(...ys) - pad);
    const out = document.createElement('canvas');
    out.width = Math.ceil(Math.max(...xs) + pad) - left;
    out.height = Math.ceil(Math.max(...ys) + pad) - top;
    this.redraw(out, left, top);
    try {
      this.done.emit(await canvasBlob(out));
    } finally {
      out.width = out.height = 0;
    }
  }
}
