import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { Header, Icon } from '@shared';

@Component({
  imports: [Header, Icon, RouterLink, RouterLinkActive, RouterOutlet, TranslatePipe],
  selector: 'ab-root',
  template: `
    <ab-header title="Media">
      <a routerLink="/library" routerLinkActive="active"
        ><ab-icon name="library" /> {{ 'nav.library' | translate }}</a
      >
      <a routerLink="/add" routerLinkActive="active"
        ><ab-icon name="plus" /> {{ 'nav.add' | translate }}</a
      >
    </ab-header>
    <main class="page">
      <router-outlet />
    </main>
    <!-- TMDB's terms require this credit. -->
    <footer class="credit" [innerHTML]="'credit' | translate"></footer>
  `,
})
export class App {}
