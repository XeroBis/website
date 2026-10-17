export type AppName = 'portfolio' | 'workout' | 'cards' | 'media' | 'auth';

/**
 * Per-build settings. `environment.ts` is the prod build; every app's
 * development build swaps in `environment.development.ts` (angular.json
 * `fileReplacements`). Read it through the `ENVIRONMENT` token, so tests can
 * provide their own.
 */
export interface Environment {
  production: boolean;
  /** Origin of each app; `auth` hosts the login page. */
  appUrls: Record<AppName, string>;
}
