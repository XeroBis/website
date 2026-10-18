import { Environment } from './environment.model';

// Ports from angular.json (`ng serve` of each app).
export const environment: Environment = {
  production: false,
  cookieDomain: null,
  appUrls: {
    portfolio: 'http://localhost:4600',
    workout: 'http://localhost:4601',
    cards: 'http://localhost:4602',
    media: 'http://localhost:4603',
    auth: 'http://localhost:4604',
  },
};
