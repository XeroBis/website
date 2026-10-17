import { Environment } from '@shared';

import { redirectTarget } from './redirect';

const prod: Environment = {
  production: true,
  appUrls: {
    portfolio: 'https://alanbignon.com',
    workout: 'https://workout.alanbignon.com',
    cards: 'https://cards.alanbignon.com',
    media: 'https://media.alanbignon.com',
    auth: 'https://auth.alanbignon.com',
  },
};
const dev: Environment = { ...prod, production: false, appUrls: { ...prod.appUrls, portfolio: 'http://localhost:4600' } };

describe('redirectTarget', () => {
  describe('in prod', () => {
    it.each([
      'https://alanbignon.com/',
      'https://cards.alanbignon.com/decks/3?tab=a',
      'https://auth.alanbignon.com/',
    ])('follows %s', (url) => {
      expect(redirectTarget(url, prod)).toBe(url);
    });

    it.each([
      'http://cards.alanbignon.com/', // not https
      'https://evil.com/',
      'https://alanbignon.com.evil.com/',
      'https://evilalanbignon.com/',
      'https://user:pw@cards.alanbignon.com/',
      'https://cards.alanbignon.com:8443/',
      'javascript:alert(1)',
      '//evil.com/',
      '/relative',
      'http://localhost:4602/',
      '',
      null,
    ])('falls back to the portfolio for %s', (url) => {
      expect(redirectTarget(url, prod)).toBe('https://alanbignon.com/');
    });
  });

  describe('in dev', () => {
    it.each(['http://localhost:4600/', 'http://localhost:4602/x', 'http://localhost:4604/'])(
      'follows %s',
      (url) => {
        expect(redirectTarget(url, dev)).toBe(url);
      },
    );

    it.each([
      'http://localhost:4599/',
      'http://localhost:4605/',
      'http://localhost/',
      'http://localhost:8400/api',
      'https://localhost:4602/',
      'http://127.0.0.1:4602/',
      'https://cards.alanbignon.com/',
      null,
    ])('falls back to the portfolio for %s', (url) => {
      expect(redirectTarget(url, dev)).toBe('http://localhost:4600/');
    });
  });
});
