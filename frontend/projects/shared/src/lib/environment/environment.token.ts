import { InjectionToken } from '@angular/core';

import { environment } from './environment';
import { Environment } from './environment.model';

export const ENVIRONMENT = new InjectionToken<Environment>('ENVIRONMENT', {
  providedIn: 'root',
  factory: () => environment,
});
