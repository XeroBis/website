/** Names shared with the backend (`core/security.py`). */
export const CSRF_COOKIE = 'csrf';
export const CSRF_HEADER = 'x-csrf-token';

export function readCookie(name: string, cookies = document.cookie): string | null {
  for (const part of cookies.split('; ')) {
    const [key, ...value] = part.split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}
