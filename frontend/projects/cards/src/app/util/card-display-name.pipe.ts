import { Pipe, PipeTransform } from '@angular/core';

import { CardNameService } from '../services/card-name.service';

/** Resolves a raw catalog `name` to the single-language name shown to the
 * user (French when known and the app is in French, else English). Impure
 * because the underlying translations map loads asynchronously after the
 * pipe first renders. */
@Pipe({ name: 'cardDisplayName', standalone: true, pure: false })
export class CardDisplayNamePipe implements PipeTransform {
  constructor(private cardNameService: CardNameService) {}

  transform(name: string | null | undefined): string {
    return name ? this.cardNameService.displayName(name) : '';
  }
}
