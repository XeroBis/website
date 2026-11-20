// Mirrors backend/domains/media/schemas.py (`/api/media`).

export type MediaType = 'book' | 'film' | 'series';
export type MediaSource = 'tmdb' | 'googlebooks' | 'manual';
export type EntryStatus = 'want' | 'in_progress' | 'done' | 'dropped';
/** `books` = books, `videos` = films and series. */
export type Shelf = 'books' | 'videos';
export type JournalEvent = 'started' | 'finished';
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
  /** Changes with the cover: part of its URL, which is cached as immutable. */
  updated_at: string;
}

export interface Session {
  id: number;
  started_on: string | null;
  finished_on: string | null;
  /** Finished on an unknown date (`finished_on` is null). */
  undated: boolean;
}

export interface EntrySummary {
  id: number;
  status: EntryStatus;
  /** 1-10 = 0.5-5 stars. */
  rating: number | null;
  /** Books only (a paper copy). */
  owned: boolean;
  current_season: number | null;
  current_episode: number | null;
  /** Books only. */
  series_id: number | null;
  series_name: string | null;
  series_volume: number | null;
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
  source: 'tmdb' | 'googlebooks';
  external_id: string;
  type: MediaType;
  title: string;
  year: number | null;
  creators: string | null;
  thumb_url: string | null;
  library_entry_id: number | null;
  /** The entry's state, when it's in the library. */
  library_status: EntryStatus | null;
  library_owned: boolean | null;
  /** Books: the entry's series, when it's in the library. */
  library_series_id: number | null;
}

export interface LibraryFilters {
  shelf?: Shelf;
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
  owned?: boolean;
  current_season?: number;
  current_episode?: number;
  series_id?: number | null;
  series_volume?: number | null;
}

export interface SessionInput {
  started_on: string | null;
  finished_on: string | null;
  undated?: boolean;
}

/** How an entry is added (both add routes). */
export interface AddOptions {
  status: EntryStatus;
  /** With status `done`: the read has no date. */
  undated?: boolean;
  owned: boolean;
  series_id?: number | null;
  series_volume?: number | null;
}

export interface BookSeries {
  id: number;
  name: string;
  volumes: number;
  read: number;
  owned: number;
  cover_item: MediaItem | null;
}

export interface BookSeriesDetail extends BookSeries {
  entries: EntrySummary[];
}

export interface JournalEntry {
  date: string;
  event: JournalEvent;
  session_id: number;
  entry: EntrySummary;
}

export interface JournalQuery {
  year: number;
  /** 1-12; absent = the whole year. */
  month?: number | null;
  type?: MediaType | null;
  event?: JournalEvent | null;
}

export type QuickAction = 'start' | 'finish' | 'drop' | 'next-episode';
