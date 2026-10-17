import { Routes } from '@angular/router';

import { Placeholder, appGuard } from '@shared';

export const routes: Routes = [
  { path: '', component: Placeholder, canActivate: [appGuard('cards')], data: { appName: 'Cards' } },
  { path: '**', redirectTo: '' },
];
