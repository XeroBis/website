import { Component, inject, effect, untracked } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LanguageService, AuthService, Header, Icon, IconName } from '@shared';
import { ToastComponent } from './components/shared/toast/toast.component';
const LINKS: { path: string; key: string; icon: IconName }[] = [
  { path: '/browse', key: 'browse', icon: 'library' },
  { path: '/sets', key: 'sets', icon: 'layers' },
  { path: '/collection', key: 'collection', icon: 'book' },
  { path: '/missing', key: 'missing', icon: 'list' },
  { path: '/decks', key: 'decks', icon: 'layers' },
  { path: '/combats', key: 'combats', icon: 'play' },
  { path: '/purchases', key: 'purchases', icon: 'list' },
  { path: '/shopping-lists', key: 'shoppingLists', icon: 'check' },
  { path: '/shares', key: 'shares', icon: 'share' },
  { path: '/convert', key: 'convert', icon: 'repeat' },
  { path: '/gestion', key: 'gestion', icon: 'database' },
];
@Component({
  selector: 'ab-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    TranslatePipe,
    Header,
    Icon,
    ToastComponent,
  ],
  template: `
    <ab-header title="Cards">
      @if (auth.canUse('cards')) {
        @for (link of links; track link.path) {
          <a [routerLink]="link.path" routerLinkActive="active"
            ><ab-icon [name]="link.icon" /> {{ 'nav.' + link.key | translate }}</a
          >
        }
        @if (auth.isAdmin()) {
          <a routerLink="/catalog-management" routerLinkActive="active"
            ><ab-icon name="shield" /> {{ 'nav.catalogManagement' | translate }}</a
          >
        }
      }
    </ab-header>
    <main class="page"><router-outlet /></main>
    <app-toast />
  `,
})
export class App {
  readonly auth = inject(AuthService);
  readonly links = LINKS;
  private readonly language = inject(LanguageService);
  private readonly router = inject(Router);
  constructor() {
    let previous = this.language.current();
    effect(() => {
      const language = this.language.current();
      if (language !== previous) {
        previous = language;
        untracked(() => {
          if (this.router.navigated)
            void this.router.navigateByUrl(this.router.url, {
              replaceUrl: true,
              onSameUrlNavigation: 'reload',
            });
        });
      }
    });
  }
}
