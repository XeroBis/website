import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { DETECTOR_LOADER, Detector, isbnFromBarcode } from '../media/barcode';

/** Time between two reads of the video. */
const SCAN_INTERVAL_MS = 150;

/**
 * A full-screen viewfinder on the back camera that reads a book's barcode.
 * Emits the first ISBN it reads, or `closed` (with an error key, or null on
 * Cancel / Escape). The parent removes it on either.
 */
@Component({
  selector: 'ab-isbn-scanner',
  imports: [TranslatePipe],
  template: `
    <dialog
      #dialog
      class="dialog scanner"
      aria-labelledby="scanner-title"
      (cancel)="$event.preventDefault(); cancel()"
    >
      <h2 id="scanner-title" class="dialog-title">{{ 'scan.title' | translate }}</h2>
      <div class="viewfinder">
        <video #video muted playsinline></video>
        <span class="aim" aria-hidden="true"></span>
      </div>
      <p class="dialog-message" aria-live="polite">
        {{ (ready() ? 'scan.hint' : 'scan.starting') | translate }}
      </p>
      <div class="dialog-actions">
        <button type="button" class="btn ghost" data-testid="scan-cancel" (click)="cancel()">
          {{ 'dialog.cancel' | translate }}
        </button>
      </div>
    </dialog>
  `,
})
export class IsbnScanner {
  readonly scanned = output<string>();
  readonly closed = output<string | null>();

  protected readonly ready = signal(false);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly loadDetector = inject(DETECTOR_LOADER);
  private stream: MediaStream | null = null;
  private stopped = false;

  constructor() {
    afterNextRender(() => {
      const el = this.dialog().nativeElement;
      if (el.showModal) el.showModal();
      else el.setAttribute('open', '');
      void this.start();
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  protected cancel(): void {
    this.stop();
    this.closed.emit(null);
  }

  private async start(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    } catch (e) {
      this.fail(
        (e as { name?: string })?.name === 'NotAllowedError' ? 'scan.denied' : 'scan.noCamera',
      );
      return;
    }
    if (this.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    const video = this.video().nativeElement;
    video.srcObject = stream;
    await video.play().catch(() => undefined);

    let detector: Detector;
    try {
      detector = await this.loadDetector();
    } catch {
      this.fail('scan.failed');
      return;
    }
    this.ready.set(true);
    await this.read(detector, video);
  }

  /** Reads the video until an ISBN shows up or the scanner closes. */
  private async read(detector: Detector, video: HTMLVideoElement): Promise<void> {
    while (!this.stopped) {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const codes = await detector.detect(video).catch(() => []);
        const isbn = codes.map((c) => isbnFromBarcode(c.rawValue)).find((i) => i !== null);
        if (isbn && !this.stopped) {
          this.stop();
          this.scanned.emit(isbn);
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, SCAN_INTERVAL_MS));
    }
  }

  private fail(error: string): void {
    if (this.stopped) return;
    this.stop();
    this.closed.emit(error);
  }

  private stop(): void {
    this.stopped = true;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    const el = this.dialog().nativeElement;
    if (el.open) {
      if (el.close) el.close();
      else el.removeAttribute('open');
    }
  }
}
