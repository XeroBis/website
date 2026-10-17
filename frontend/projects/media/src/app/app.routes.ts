import { Routes } from '@angular/router';

import { appGuard } from '@shared';

export const routes: Routes = [
  {
    path: '',
    canActivate: [appGuard('media')],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'library' },
      {
        path: 'library',
        title: 'pageTitle.library',
        loadComponent: () => import('./pages/library/library').then((m) => m.Library),
      },
      {
        path: 'library/:id',
        loadComponent: () => import('./pages/entry/entry').then((m) => m.EntryPage),
      },
      {
        path: 'add',
        title: 'pageTitle.add',
        loadComponent: () => import('./pages/add/add').then((m) => m.Add),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
