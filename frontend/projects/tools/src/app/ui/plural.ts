import { Pipe, PipeTransform, inject } from '@angular/core';

import { LanguageService } from '@shared';

/**
 * Picks `<key>.one` or `<key>.other` for `count`, by the current language's
 * rule (French: 0 and 1 are singular). Then translate it with the count:
 * `{{ 'common.page' | plural: n | translate: { count: n } }}`.
 */
@Pipe({ name: 'plural', pure: false })
export class PluralPipe implements PipeTransform {
  private readonly language = inject(LanguageService);

  transform(key: string, count: number): string {
    const one = this.language.current() === 'fr' ? count <= 1 : count === 1;
    return `${key}.${one ? 'one' : 'other'}`;
  }
}
