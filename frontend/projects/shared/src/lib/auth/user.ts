import { Language } from '../i18n/language';

/** `UserOut` from `/api/auth/me`, `/login`, `/register`. */
export interface User {
  id: number;
  email: string;
  pseudo: string;
  language: Language;
  is_admin: boolean;
}

export interface Credentials {
  email: string;
  password: string;
}

export interface Registration extends Credentials {
  pseudo: string;
}
