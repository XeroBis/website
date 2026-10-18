import { Language } from '../i18n/language';
import { Theme } from '../theme/theme';

/** Apps access is granted to, per user (`core.user_apps`), in display order. */
export const GRANTABLE_APPS = ['portfolio', 'workout', 'cards', 'media'] as const;
export type GrantableApp = (typeof GRANTABLE_APPS)[number];

/** `UserOut` from `/api/auth/me`, `/login`, `/register`. */
export interface User {
  id: number;
  email: string;
  pseudo: string;
  language: Language;
  theme: Theme;
  is_admin: boolean;
  /** What the user can use: their grants, or every app for an admin. */
  apps: GrantableApp[];
}

/** A user as listed on the auth app's `/admin/users` (`/api/auth/users`). */
export interface AdminUser extends User {
  created_at: string;
}

export interface Credentials {
  email: string;
  password: string;
}

export interface Registration extends Credentials {
  pseudo: string;
}
