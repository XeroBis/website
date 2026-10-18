import { Injectable } from '@angular/core';

/** Single source of truth for how a card name is shown. The API already
 * resolves `name` to the account's selected card language, so this remains
 * a thin pass-through for every list/detail/deck view. */
@Injectable({ providedIn: 'root' })
export class CardNameService {
  displayName(name: string): string {
    return name;
  }
}
