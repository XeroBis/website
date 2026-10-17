import { IconName } from '@shared';

import { EntryStatus, EntrySummary, MediaItem, MediaType, OwnedFormat } from './models';

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

export function formatLabel(format: OwnedFormat): string {
  return `format.${format}`;
}

/** The formats offered for a type (the backend accepts any of them). */
export const FORMATS_FOR: Record<MediaType, OwnedFormat[]> = {
  book: ['paperback', 'hardcover', 'ebook', 'audiobook'],
  film: ['dvd', 'bluray', 'bluray_4k', 'digital'],
  series: ['dvd', 'bluray', 'bluray_4k', 'digital'],
};

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
