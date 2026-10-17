import { Environment } from '@shared';

const DEV_PORTS = { min: 4600, max: 4604 };
const PROD_DOMAIN = 'alanbignon.com';

/**
 * Whether `?redirect=` may be followed after login, so the login page can't
 * be used to bounce users to another site. Prod: https on alanbignon.com or
 * any subdomain. Dev: http://localhost on an app's port (4600-4604).
 */
export function isAllowedRedirect(url: URL, env: Environment): boolean {
  if (url.username || url.password) return false;
  if (env.production) {
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      (url.hostname === PROD_DOMAIN || url.hostname.endsWith(`.${PROD_DOMAIN}`))
    );
  }
  const port = Number(url.port);
  return (
    url.protocol === 'http:' &&
    url.hostname === 'localhost' &&
    port >= DEV_PORTS.min &&
    port <= DEV_PORTS.max
  );
}

/** Where to go after login/sign-up: `raw` if allowed, else the portfolio. */
export function redirectTarget(raw: string | null | undefined, env: Environment): string {
  if (raw) {
    try {
      const url = new URL(raw);
      if (isAllowedRedirect(url, env)) return url.href;
    } catch {
      // not an absolute URL: fall through
    }
  }
  return `${env.appUrls.portfolio}/`;
}
