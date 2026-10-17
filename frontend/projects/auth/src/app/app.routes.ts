import { Routes } from '@angular/router';

import { authGuard } from '@shared';

import { Account } from './account/account';
import { Login } from './login/login';
import { Signup } from './signup/signup';

export const routes: Routes = [
  { path: '', component: Account, canActivate: [authGuard] },
  { path: 'login', component: Login },
  { path: 'signup', component: Signup },
  { path: '**', redirectTo: '' },
];
