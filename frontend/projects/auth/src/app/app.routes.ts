import { Routes } from '@angular/router';

import { adminGuard, authGuard } from '@shared';

import { Account } from './account/account';
import { Login } from './login/login';
import { Signup } from './signup/signup';
import { Users } from './users/users';

export const routes: Routes = [
  { path: '', component: Account, canActivate: [authGuard] },
  { path: 'login', component: Login },
  { path: 'signup', component: Signup },
  { path: 'admin/users', component: Users, canActivate: [adminGuard] },
  { path: '**', redirectTo: '' },
];
