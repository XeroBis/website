import { Routes } from '@angular/router';

import { appGuard } from '@shared';

const shelf = () => import('./pages/library/library').then((m) => m.Library);

export const routes: Routes = [
  {
    path: '',
    canActivate: [appGuard('media')],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'books' },
      {
        path: 'books',
        title: 'pageTitle.books',
        data: { shelf: 'books' },
        loadComponent: shelf,
      },
      {
        path: 'videos',
        title: 'pageTitle.videos',
        data: { shelf: 'videos' },
        loadComponent: shelf,
      },
      {
        path: 'journal',
        title: 'pageTitle.journal',
        loadComponent: () => import('./pages/journal/journal').then((m) => m.Journal),
      },
      {
        path: 'entries/:id',
        loadComponent: () => import('./pages/entry/entry').then((m) => m.EntryPage),
      },
      {
        path: 'add',
        title: 'pageTitle.add',
        loadComponent: () => import('./pages/add/add').then((m) => m.Add),
      },
      // Old URLs, from before the split into books and videos.
      { path: 'library', pathMatch: 'full', redirectTo: 'books' },
      { path: 'library/:id', redirectTo: 'entries/:id' },
    ],
  },
  { path: '**', redirectTo: '' },
];
