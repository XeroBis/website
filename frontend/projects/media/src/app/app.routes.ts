import { Routes } from '@angular/router';

import { Placeholder } from '@shared';

export const routes: Routes = [
  { path: '', component: Placeholder, data: { appName: 'Media' } },
  { path: '**', redirectTo: '' },
];
