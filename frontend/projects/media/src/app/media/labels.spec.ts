import { FILM, SERIES, entry } from '../testing';
import { episodeLabel, hue, progressPercent, statusLabel } from './labels';
import { localTitle } from './local-title';

describe('media labels', () => {
  it('words statuses by type', () => {
    expect(statusLabel('in_progress', 'book')).toBe('status.book.in_progress');
    expect(statusLabel('done', 'series')).toBe('status.watch.done');
    expect(statusLabel('want')).toBe('status.any.want');
  });

  it('labels series progress', () => {
    expect(episodeLabel(entry({ item: SERIES, current_season: 2, current_episode: 3 }))).toBe(
      'S2 · E3',
    );
    expect(episodeLabel(entry({ item: SERIES, current_season: 1, current_episode: null }))).toBe(
      'S1 · E0',
    );
    expect(episodeLabel(entry())).toBeNull();
    expect(progressPercent(entry({ progress: { watched: 9, total: 19 } }))).toBe(47);
    expect(progressPercent(entry())).toBeNull();
  });

  it('gives each item a stable hue', () => {
    expect(hue(FILM)).toBe(hue({ id: FILM.id }));
    expect(hue({ id: 1 })).not.toBe(hue({ id: 2 }));
  });

  it('picks the French title for French viewers when known', () => {
    expect(localTitle(FILM, 'fr')).toBe('Matrix');
    expect(localTitle(FILM, 'en')).toBe('The Matrix');
    expect(localTitle(SERIES, 'fr')).toBe('Severance');
  });
});
