import { Pipe, PipeTransform } from '@angular/core';

import { Language } from '@shared';

import { MediaItem } from './models';

/** The title in `lang`: `title_fr` for French when known, else `title`. */
export function localTitle(item: Pick<MediaItem, 'title' | 'title_fr'>, lang: Language): string {
  return (lang === 'fr' && item.title_fr) || item.title;
}

/** `{{ item | localTitle: lang() }}`: pure, re-run when the language changes. */
@Pipe({ name: 'localTitle' })
export class LocalTitlePipe implements PipeTransform {
  transform(item: Pick<MediaItem, 'title' | 'title_fr'>, lang: Language): string {
    return localTitle(item, lang);
  }
}

/** `{{ item | localSynopsis: lang() }}`, same rule as `localTitle`. */
@Pipe({ name: 'localSynopsis' })
export class LocalSynopsisPipe implements PipeTransform {
  transform(item: Pick<MediaItem, 'synopsis' | 'synopsis_fr'>, lang: Language): string | null {
    return (lang === 'fr' && item.synopsis_fr) || item.synopsis;
  }
}
