import { resolveLanguage } from './language';

describe('resolveLanguage', () => {
  it("prefers the logged-in user's language", () => {
    expect(resolveLanguage('en', 'fr', 'fr-FR')).toBe('en');
  });

  it('then the last language used on this site', () => {
    expect(resolveLanguage(null, 'en', 'fr-FR')).toBe('en');
  });

  it("then the browser's language, when it's en or fr", () => {
    expect(resolveLanguage(null, null, 'en-GB')).toBe('en');
    expect(resolveLanguage(undefined, 'garbage', 'EN')).toBe('en');
  });

  it('then French', () => {
    expect(resolveLanguage(null, null, 'de-DE')).toBe('fr');
    expect(resolveLanguage(null, null, undefined)).toBe('fr');
  });
});
