import { Routes } from '@angular/router';

import { Placeholder } from '@shared';

export const routes: Routes = [
  { path: '', component: Placeholder, data: { appName: 'Account' } },
  { path: '**', redirectTo: '' },
];
