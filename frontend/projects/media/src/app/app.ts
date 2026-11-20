import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { Header, Icon } from '@shared';

import { DialogHost } from './ui/dialogs';

@Component({
  imports: [DialogHost, Header, Icon, RouterLink, RouterLinkActive, RouterOutlet, TranslatePipe],
  selector: 'ab-root',
  template: `
    <ab-header title="Media">
      <a routerLink="/books" routerLinkActive="active"
        ><ab-icon name="book" /> {{ 'nav.books' | translate }}</a
      >
      <a routerLink="/videos" routerLinkActive="active"
        ><ab-icon name="film" /> {{ 'nav.videos' | translate }}</a
      >
      <a routerLink="/journal" routerLinkActive="active"
        ><ab-icon name="calendar" /> {{ 'nav.journal' | translate }}</a
      >
    </ab-header>
    <main class="page">
      <router-outlet />
    </main>
    <!-- TMDB's terms require this credit. -->
    <footer class="credit" [innerHTML]="'credit' | translate"></footer>
    <ab-dialogs />
  `,
})
export class App {}
