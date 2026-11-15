import { Routes } from '@angular/router';

import { appGuard } from '@shared';

export const routes: Routes = [
  {
    path: '',
    canActivate: [appGuard('tools')],
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'pageTitle.home',
        loadComponent: () => import('./pages/home').then((m) => m.Home),
      },
      {
        path: 'merge',
        title: 'pageTitle.merge',
        loadComponent: () => import('./pages/merge').then((m) => m.Merge),
      },
      {
        path: 'extract',
        title: 'pageTitle.extract',
        loadComponent: () => import('./pages/extract').then((m) => m.Extract),
      },
      {
        path: 'organize',
        title: 'pageTitle.organize',
        loadComponent: () => import('./pages/organize').then((m) => m.Organize),
      },
      {
        path: 'images-to-pdf',
        title: 'pageTitle.imagesToPdf',
        loadComponent: () => import('./pages/images-to-pdf').then((m) => m.ImagesToPdf),
      },
      {
        path: 'pdf-to-images',
        title: 'pageTitle.pdfToImages',
        loadComponent: () => import('./pages/pdf-to-images').then((m) => m.PdfToImages),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
