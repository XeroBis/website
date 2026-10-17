import { Routes } from '@angular/router';

import { adminGuard } from '@shared';

import { ProjectForm } from './project-form/project-form';
import { ProjectList } from './project-list/project-list';

export const routes: Routes = [
  { path: '', component: ProjectList },
  { path: 'admin/projects/new', component: ProjectForm, canActivate: [adminGuard] },
  { path: 'admin/projects/:id', component: ProjectForm, canActivate: [adminGuard] },
  { path: '**', redirectTo: '' },
];
