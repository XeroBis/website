import { Environment } from '../environment/environment.model';
import { User } from './user';

// Test helpers (not exported from public-api).

export const TEST_ENV: Environment = {
  production: false,
  appUrls: {
    portfolio: 'http://localhost:4600',
    workout: 'http://localhost:4601',
    cards: 'http://localhost:4602',
    media: 'http://localhost:4603',
    auth: 'http://localhost:4604',
  },
};

export const TEST_USER: User = {
  id: 1,
  email: 'user@example.com',
  pseudo: 'Testy',
  language: 'fr',
  is_admin: false,
  apps: [],
};

export function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/`;
}

export function clearCookie(name: string): void {
  document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
