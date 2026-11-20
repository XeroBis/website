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

describe('volumeFromTitle', () => {
  it('reads the volume number from a title', async () => {
    const { volumeFromTitle } = await import('./labels');
    expect(volumeFromTitle('One Piece, Vol. 12: The Legend')).toBe(12);
    expect(volumeFromTitle('One Piece - Tome 3')).toBe(3);
    expect(volumeFromTitle('Naruto T27')).toBe(27);
    expect(volumeFromTitle('Berserk Volume 41')).toBe(41);
    expect(volumeFromTitle('Saga #4')).toBe(4);
    expect(volumeFromTitle('One Piece 100')).toBe(100);
    expect(volumeFromTitle('Romance Dawn')).toBeNull();
  });
});

describe('seriesNameFromTitle', () => {
  it('keeps what comes before the volume marker', async () => {
    const { seriesNameFromTitle } = await import('./labels');
    expect(seriesNameFromTitle('One Piece, tome 1')).toBe('One Piece');
    expect(seriesNameFromTitle('One Piece, Vol. 12: The Legend')).toBe('One Piece');
    expect(seriesNameFromTitle('Naruto T27')).toBe('Naruto');
    expect(seriesNameFromTitle('Saga #4')).toBe('Saga');
    expect(seriesNameFromTitle('One Piece 100')).toBe('One Piece');
    expect(seriesNameFromTitle('Romance Dawn')).toBe('Romance Dawn');
    expect(seriesNameFromTitle('1984')).toBe('1984');
  });
});
