import { applyTheme, resolveTheme } from './theme';

describe('resolveTheme', () => {
  it("prefers the user's theme, then the stored one, then System", () => {
    expect(resolveTheme('dark', 'light')).toBe('dark');
    expect(resolveTheme(null, 'light')).toBe('light');
    expect(resolveTheme(undefined, 'sepia')).toBe('system');
    expect(resolveTheme(null, null)).toBe('system');
  });
});

describe('applyTheme', () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <meta name="theme-color" content="#fff" data-scheme="light" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="#000" data-scheme="dark" media="(prefers-color-scheme: dark)" />`;
  });

  const media = () =>
    [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.media);

  it('forces a theme on <html> and its theme-color', () => {
    applyTheme(document, 'dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(media()).toEqual(['not all', 'all']);
  });

  it('follows the system again for System', () => {
    applyTheme(document, 'light');
    applyTheme(document, 'system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(media()).toEqual(['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']);
  });
});
