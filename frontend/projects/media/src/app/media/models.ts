// Mirrors backend/domains/media/schemas.py (`/api/media`).

export type MediaType = 'book' | 'film' | 'series';
export type MediaSource = 'tmdb' | 'openlibrary' | 'manual';
export type EntryStatus = 'want' | 'in_progress' | 'done' | 'dropped';
export type OwnedFormat =
  'paperback' | 'hardcover' | 'ebook' | 'audiobook' | 'dvd' | 'bluray' | 'bluray_4k' | 'digital';
export type LibrarySort = 'added' | 'title' | 'year' | 'rating' | 'finished';

export interface MediaItem {
  id: number;
  type: MediaType;
  title: string;
  /** French title when the source has one (display: `localTitle`). */
  title_fr: string | null;
  original_title: string | null;
  year: number | null;
  creators: string | null;
  genres: string[];
  synopsis: string | null;
  synopsis_fr: string | null;
  runtime_minutes: number | null;
  isbn: string | null;
  season_episode_counts: number[] | null;
  source: MediaSource;
  external_id: string | null;
  has_cover: boolean;
}

export interface Session {
  id: number;
  started_on: string | null;
  finished_on: string | null;
}

export interface EntrySummary {
  id: number;
  status: EntryStatus;
  /** 1-10 = 0.5-5 stars. */
  rating: number | null;
  owned_formats: OwnedFormat[];
  current_season: number | null;
  current_episode: number | null;
  added_at: string;
  updated_at: string;
  last_finished_on: string | null;
  progress: { watched: number; total: number } | null;
  at_last_known_episode: boolean;
  item: MediaItem;
}

export interface EntryDetail extends EntrySummary {
  notes: string | null;
  sessions: Session[];
}

export interface SearchResult {
  source: 'tmdb' | 'openlibrary';
  external_id: string;
  type: MediaType;
  title: string;
  year: number | null;
  creators: string | null;
  thumb_url: string | null;
  library_entry_id: number | null;
}

export interface LibraryFilters {
  type?: MediaType | null;
  status?: EntryStatus | null;
  owned?: boolean | null;
  genre?: string | null;
  q?: string | null;
  sort?: LibrarySort;
}

export interface EntryUpdate {
  rating?: number | null;
  notes?: string | null;
  owned_formats?: OwnedFormat[];
  current_season?: number;
  current_episode?: number;
}

export interface SessionInput {
  started_on: string | null;
  finished_on: string | null;
}

export type QuickAction = 'start' | 'finish' | 'drop' | 'next-episode';
