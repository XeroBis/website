import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthService, Header, Icon, IconName } from '@shared';

const LINKS: { path: string; key: string; icon: IconName }[] = [
  { path: '/dashboard', key: 'nav.dashboard', icon: 'chart' },
  { path: '/workouts', key: 'nav.workouts', icon: 'list' },
  { path: '/templates', key: 'nav.templates', icon: 'layers' },
  { path: '/circuits', key: 'nav.circuits', icon: 'repeat' },
  { path: '/exercises', key: 'nav.exercises', icon: 'dumbbell' },
  { path: '/equipments', key: 'nav.equipments', icon: 'wrench' },
  { path: '/data', key: 'nav.data', icon: 'database' },
];

@Component({
  imports: [Header, Icon, RouterLink, RouterLinkActive, RouterOutlet, TranslatePipe],
  selector: 'ab-root',
  template: `
    <ab-header title="Workout">
      @for (link of links; track link.path) {
        <a [routerLink]="link.path" routerLinkActive="active"
          ><ab-icon [name]="link.icon" /> {{ link.key | translate }}</a
        >
      }
      @if (auth.isAdmin()) {
        <a routerLink="/admin" routerLinkActive="active"
          ><ab-icon name="shield" /> {{ 'nav.admin' | translate }}</a
        >
      }
    </ab-header>
    <main class="page">
      <router-outlet />
    </main>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly links = LINKS;
}
