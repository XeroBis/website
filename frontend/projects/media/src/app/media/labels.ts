import { IconName } from '@shared';

import { EntryStatus, EntrySummary, MediaItem, MediaType, Shelf } from './models';

export const TYPES: MediaType[] = ['book', 'film', 'series'];

/** Translation keys; show them through `| translate`. */
export const TYPE_LABEL: Record<MediaType, string> = {
  book: 'type.book',
  film: 'type.film',
  series: 'type.series',
};
export const TYPE_PLURAL: Record<MediaType, string> = {
  book: 'types.book',
  film: 'types.film',
  series: 'types.series',
};
export const TYPE_ICON: Record<MediaType, IconName> = { book: 'book', film: 'film', series: 'tv' };

export const STATUSES: EntryStatus[] = ['want', 'in_progress', 'done', 'dropped'];

/** Status wording (a translation key) depends on the type: "Reading" a book, "Watching" a film. */
export function statusLabel(status: EntryStatus, type?: MediaType): string {
  const group = !type ? 'any' : type === 'book' ? 'book' : 'watch';
  return `status.${group}.${status}`;
}

/** The types on each shelf (Bibliothèque: books; Vidéothèque: films and series). */
export const SHELF_TYPES: Record<Shelf, MediaType[]> = {
  books: ['book'],
  videos: ['film', 'series'],
};

export function shelfOf(type: MediaType): Shelf {
  return type === 'book' ? 'books' : 'videos';
}

/** The shelf page's URL for a type: `/books` or `/videos`. */
export function shelfUrl(type: MediaType): string {
  return `/${shelfOf(type)}`;
}

/** Stable hue per catalog item, for the generated cover placeholder and glows. */
export function hue(item: Pick<MediaItem, 'id'>): number {
  return Math.round((item.id * 137.508) % 360);
}

export function episodeLabel(entry: EntrySummary): string | null {
  if (entry.item.type !== 'series' || entry.current_season === null) return null;
  return `S${entry.current_season} · E${entry.current_episode ?? 0}`;
}

/** 0-100 for the progress ring, or null when there's nothing to show. */
export function progressPercent(entry: EntrySummary): number | null {
  if (!entry.progress || entry.progress.total === 0) return null;
  return Math.round((entry.progress.watched / entry.progress.total) * 100);
}

/**
 * The volume number in a title: "Vol. 12", "Volume 12", "Tome 12", "T12", "#12",
 * else a trailing number ("One Piece 12"). Null when there's none.
 */
export function volumeFromTitle(title: string): number | null {
  const match =
    /(?:\bvol(?:ume)?\.?|\btome|\bt\.?|#)\s*(\d{1,4})\b/i.exec(title) ??
    /(?:^|\D)(\d{1,4})\s*$/.exec(title);
  return match ? Number(match[1]) : null;
}

/**
 * A series name guessed from a volume's title: what comes before its volume
 * marker ("One Piece, tome 1" → "One Piece"), else the whole title.
 */
export function seriesNameFromTitle(title: string): string {
  const marker = /[\s,.:;–—-]*(?:\bvol(?:ume)?\.?|\btome|\bt\.?|#)\s*\d{1,4}\b.*$/i;
  const name = marker.test(title)
    ? title.replace(marker, '')
    : title.replace(/[\s,.:;–—-]+\d{1,4}\s*$/, '');
  return name.trim() || title.trim();
}
