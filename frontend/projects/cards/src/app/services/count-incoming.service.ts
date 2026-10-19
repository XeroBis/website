import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'cardsCountIncoming';

/** "Count incoming as owned": whether cards on incoming purchase lists hide
 * from the missing views (set page filter and exports, /missing). On by
 * default, remembered per browser, shared by those pages. */
@Injectable({ providedIn: 'root' })
export class CountIncomingService {
  readonly enabled = signal(readStored());

  toggle(): void {
    this.enabled.set(!this.enabled());
    try {
      localStorage.setItem(STORAGE_KEY, String(this.enabled()));
    } catch {
      // Storage unavailable -- the choice just won't persist.
    }
  }
}

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}
