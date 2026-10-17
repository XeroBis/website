import { readCookie } from './cookies';

describe('readCookie', () => {
  it('finds a cookie by exact name', () => {
    expect(readCookie('csrf', 'xcsrf=no; csrf=a%3Db; other=1')).toBe('a=b');
  });

  it('returns null when absent', () => {
    expect(readCookie('csrf', 'session=1')).toBeNull();
    expect(readCookie('csrf', '')).toBeNull();
  });
});
