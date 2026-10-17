import { DOCUMENT, Injectable, inject } from '@angular/core';

/** `window.location`, behind a service so tests can stub full-page navigation. */
@Injectable({ providedIn: 'root' })
export class BrowserLocation {
  private readonly location = inject(DOCUMENT).location;

  get origin(): string {
    return this.location.origin;
  }

  get href(): string {
    return this.location.href;
  }

  /** Full-page navigation, e.g. to another app. */
  assign(url: string): void {
    this.location.assign(url);
  }
}
