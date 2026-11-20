/**
 * An ISBN-10 or ISBN-13 without hyphens or spaces (a final x upper-cased), or
 * null when the length or the check digit is wrong. Mirrors the backend's
 * `normalize_isbn`, so a bad ISBN is refused before it's sent.
 */
export function normalizeIsbn(value: string): string | null {
  const isbn = value.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const total = [...isbn].reduce((sum, c, i) => sum + (10 - i) * (c === 'X' ? 10 : Number(c)), 0);
    return total % 11 === 0 ? isbn : null;
  }
  if (/^\d{13}$/.test(isbn)) {
    const total = [...isbn].reduce((sum, c, i) => sum + Number(c) * (i % 2 ? 3 : 1), 0);
    return total % 10 === 0 ? isbn : null;
  }
  return null;
}
