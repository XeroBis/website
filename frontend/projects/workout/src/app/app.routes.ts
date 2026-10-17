import { Routes } from '@angular/router';

import { adminGuard, appGuard } from '@shared';

export const routes: Routes = [
  {
    path: '',
    canActivate: [appGuard('workout')],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        title: 'nav.dashboard',
        loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'workouts',
        title: 'nav.workouts',
        loadComponent: () => import('./pages/workouts/workouts').then((m) => m.Workouts),
      },
      {
        path: 'workouts/new',
        title: 'pageTitle.newWorkout',
        loadComponent: () => import('./pages/workout-form/workout-form').then((m) => m.WorkoutForm),
      },
      {
        path: 'workouts/:id/edit',
        title: 'pageTitle.editWorkout',
        loadComponent: () => import('./pages/workout-form/workout-form').then((m) => m.WorkoutForm),
      },
      {
        path: 'session',
        title: 'pageTitle.session',
        loadComponent: () => import('./pages/session/session').then((m) => m.SessionPage),
      },
      {
        path: 'templates',
        title: 'nav.templates',
        loadComponent: () => import('./pages/templates/templates').then((m) => m.Templates),
      },
      {
        path: 'templates/:id',
        title: 'nav.templates',
        loadComponent: () =>
          import('./pages/template-form/template-form').then((m) => m.TemplateForm),
      },
      {
        path: 'circuits',
        title: 'nav.circuits',
        loadComponent: () => import('./pages/circuits/circuits').then((m) => m.Circuits),
      },
      {
        path: 'circuits/:id',
        title: 'nav.circuits',
        loadComponent: () => import('./pages/circuit-form/circuit-form').then((m) => m.CircuitForm),
      },
      {
        path: 'exercises',
        title: 'nav.exercises',
        loadComponent: () => import('./pages/exercises/exercises').then((m) => m.Exercises),
      },
      {
        path: 'exercises/:id',
        title: 'nav.exercises',
        loadComponent: () =>
          import('./pages/exercise-form/exercise-form').then((m) => m.ExerciseForm),
      },
      {
        path: 'equipments',
        title: 'nav.equipments',
        loadComponent: () => import('./pages/equipments/equipments').then((m) => m.Equipments),
      },
      {
        path: 'data',
        title: 'nav.data',
        loadComponent: () => import('./pages/data/data').then((m) => m.Data),
      },
      {
        path: 'admin',
        title: 'nav.admin',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/admin/admin').then((m) => m.Admin),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
