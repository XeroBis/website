import { Routes } from '@angular/router';

import { appGuard, adminGuard } from '@shared';

export const routes: Routes = [
  // Token-scoped shared sets are public; all personal pages require cards access.
  {
    path: 'shared/:token',
    title: 'nav.sharedSet',
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
        title: 'nav.browse',
        loadComponent: () =>
          import('./components/browse/browse.component').then((m) => m.BrowseComponent),
      },
      {
        path: 'sets',
        title: 'nav.sets',
        loadComponent: () =>
          import('./components/sets/sets-list/sets-list.component').then(
            (m) => m.SetsListComponent,
          ),
      },
      {
        path: 'sets/:setCode',
        title: 'nav.sets',
        loadComponent: () =>
          import('./components/sets/set-detail/set-detail.component').then(
            (m) => m.SetDetailComponent,
          ),
      },
      {
        path: 'collection',
        title: 'nav.collection',
        loadComponent: () =>
          import('./components/collection/collection.component').then((m) => m.CollectionComponent),
      },
      // Compact per-set card-number ranges for in-store bulk checks.
      {
        path: 'missing',
        title: 'nav.missingCards',
        loadComponent: () =>
          import('./components/missing-intervals/missing-intervals.component').then(
            (m) => m.MissingIntervalsComponent,
          ),
      },
      {
        path: 'decks',
        title: 'nav.decks',
        loadComponent: () =>
          import('./components/deck/deck-list/deck-list.component').then(
            (m) => m.DeckListComponent,
          ),
      },
      {
        path: 'decks/:id',
        title: 'nav.decks',
        loadComponent: () =>
          import('./components/deck/deck-detail/deck-detail.component').then(
            (m) => m.DeckDetailComponent,
          ),
      },
      {
        path: 'combats',
        title: 'nav.combats',
        loadComponent: () =>
          import('./components/combats/combats.component').then((m) => m.CombatsComponent),
      },
      {
        path: 'purchases',
        title: 'nav.purchases',
        loadComponent: () =>
          import('./components/purchases/purchases.component').then((m) => m.PurchasesComponent),
      },
      {
        path: 'shopping-lists',
        title: 'nav.shoppingLists',
        loadComponent: () =>
          import('./components/shopping-lists/shopping-list-list/shopping-list-list.component').then(
            (m) => m.ShoppingListListComponent,
          ),
      },
      {
        path: 'shopping-lists/:id',
        title: 'nav.shoppingLists',
        loadComponent: () =>
          import('./components/shopping-lists/shopping-list-detail/shopping-list-detail.component').then(
            (m) => m.ShoppingListDetailComponent,
          ),
      },
      {
        path: 'convert',
        title: 'nav.convert',
        loadComponent: () =>
          import('./components/convert/convert.component').then((m) => m.ConvertComponent),
      },
      {
        path: 'shares',
        title: 'nav.shares',
        loadComponent: () =>
          import('./components/shares/shares.component').then((m) => m.SharesComponent),
      },
      {
        path: 'gestion',
        title: 'nav.gestion',
        loadComponent: () =>
          import('./components/gestion/gestion.component').then((m) => m.GestionComponent),
      },
      {
        path: 'catalog-management',
        title: 'nav.catalogManagement',
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
