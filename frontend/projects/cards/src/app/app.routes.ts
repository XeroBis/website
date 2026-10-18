import { Routes } from '@angular/router';

import { appGuard, adminGuard } from '@shared';

export const routes: Routes = [
  // Token-scoped shared sets are public; all personal pages require cards access.
  {
    path: 'shared/:token',
    loadComponent: () =>
      import('./components/sets/shared-set/shared-set.component').then((m) => m.SharedSetComponent),
  },
  {
    path: '',
    canActivate: [appGuard('cards')],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'browse' },
      {
        path: 'browse',
        loadComponent: () =>
          import('./components/browse/browse.component').then((m) => m.BrowseComponent),
      },
      {
        path: 'sets',
        loadComponent: () =>
          import('./components/sets/sets-list/sets-list.component').then(
            (m) => m.SetsListComponent,
          ),
      },
      {
        path: 'sets/:setCode',
        loadComponent: () =>
          import('./components/sets/set-detail/set-detail.component').then(
            (m) => m.SetDetailComponent,
          ),
      },
      {
        path: 'collection',
        loadComponent: () =>
          import('./components/collection/collection.component').then((m) => m.CollectionComponent),
      },
      // Compact per-set card-number ranges for in-store bulk checks.
      {
        path: 'missing',
        loadComponent: () =>
          import('./components/missing-intervals/missing-intervals.component').then(
            (m) => m.MissingIntervalsComponent,
          ),
      },
      {
        path: 'decks',
        loadComponent: () =>
          import('./components/deck/deck-list/deck-list.component').then(
            (m) => m.DeckListComponent,
          ),
      },
      {
        path: 'decks/:id',
        loadComponent: () =>
          import('./components/deck/deck-detail/deck-detail.component').then(
            (m) => m.DeckDetailComponent,
          ),
      },
      {
        path: 'combats',
        loadComponent: () =>
          import('./components/combats/combats.component').then((m) => m.CombatsComponent),
      },
      {
        path: 'purchases',
        loadComponent: () =>
          import('./components/purchases/purchases.component').then((m) => m.PurchasesComponent),
      },
      {
        path: 'shopping-lists',
        loadComponent: () =>
          import('./components/shopping-lists/shopping-list-list/shopping-list-list.component').then(
            (m) => m.ShoppingListListComponent,
          ),
      },
      {
        path: 'shopping-lists/:id',
        loadComponent: () =>
          import('./components/shopping-lists/shopping-list-detail/shopping-list-detail.component').then(
            (m) => m.ShoppingListDetailComponent,
          ),
      },
      {
        path: 'convert',
        loadComponent: () =>
          import('./components/convert/convert.component').then((m) => m.ConvertComponent),
      },
      {
        path: 'shares',
        loadComponent: () =>
          import('./components/shares/shares.component').then((m) => m.SharesComponent),
      },
      {
        path: 'gestion',
        loadComponent: () =>
          import('./components/gestion/gestion.component').then((m) => m.GestionComponent),
      },
      {
        path: 'catalog-management',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./components/catalog-management/catalog-management.component').then(
            (m) => m.CatalogManagementComponent,
          ),
      },
    ],
  },
  { path: '**', redirectTo: 'browse' },
];
