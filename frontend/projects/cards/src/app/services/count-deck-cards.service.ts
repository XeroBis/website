import { Injectable, signal } from '@angular/core';

/** "Count cards in decks as owned": whether copies in normal decks count
 * towards the Sets page's completion, the set page's ownership and the
 * missing exports. Off by default (deck copies count as not owned), shared
 * by those pages, not remembered: a reload turns it back off. */
@Injectable({ providedIn: 'root' })
export class CountDeckCardsService {
  readonly enabled = signal(false);

  toggle(): void {
    this.enabled.set(!this.enabled());
  }
}
