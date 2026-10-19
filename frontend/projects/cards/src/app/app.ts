import {
  Component,
  DestroyRef,
  DOCUMENT,
  computed,
  inject,
  effect,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { filter, map } from 'rxjs';
import { LanguageService, AuthService, BrowserLocation, Header, Icon, IconName } from '@shared';
import { ToastComponent } from './components/shared/toast/toast.component';
import { shuffleFoil } from './util/foil.util';

interface NavLink {
  path: string;
  key: string;
  icon: IconName;
  admin?: boolean;
}
type MenuKey = 'play' | 'track' | 'tools' | 'manage';
/** The old app's navbar: three top links, then four dropdowns (Manage set apart). */
const LINKS: NavLink[] = [
  { path: '/browse', key: 'browse', icon: 'library' },
  { path: '/sets', key: 'sets', icon: 'layers' },
  { path: '/collection', key: 'collection', icon: 'book' },
];
const MENUS: { key: MenuKey; links: NavLink[] }[] = [
  {
    key: 'play',
    links: [
      { path: '/decks', key: 'decks', icon: 'layers' },
      { path: '/combats', key: 'combats', icon: 'play' },
    ],
  },
  {
    key: 'track',
    links: [
      { path: '/purchases', key: 'purchases', icon: 'list' },
      { path: '/purchase-lists', key: 'purchaseLists', icon: 'truck' },
      { path: '/missing', key: 'missingCards', icon: 'list' },
    ],
  },
  {
    key: 'tools',
    links: [
      { path: '/convert', key: 'convert', icon: 'repeat' },
      { path: '/shares', key: 'shares', icon: 'share' },
    ],
  },
  {
    key: 'manage',
    links: [
      { path: '/catalog-management', key: 'catalogManagement', icon: 'shield', admin: true },
      { path: '/gestion', key: 'gestion', icon: 'database' },
    ],
  },
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
  host: {
    '(document:click)': 'closeMenuOutside($event)',
    '(document:keydown.escape)': 'openMenu.set(null)',
  },
  template: `
    <!-- The public shared set has no session and no way into the rest of the app. -->
    @if (!isSharedRoute()) {
      <ab-header [title]="'app.name' | translate">
        @if (auth.canUse('cards')) {
          @for (link of links; track link.path) {
            <a [routerLink]="link.path" routerLinkActive="active" (click)="openMenu.set(null)"
              ><ab-icon [name]="link.icon" /> {{ 'nav.' + link.key | translate }}</a
            >
          }
          @for (menu of menus; track menu.key) {
            <div
              class="nav-menu"
              [class.manage-menu]="menu.key === 'manage'"
              [class.open]="openMenu() === menu.key"
              routerLinkActive="active-group"
            >
              <button
                type="button"
                [attr.aria-expanded]="openMenu() === menu.key"
                (click)="toggleMenu(menu.key)"
              >
                {{ 'nav.' + menu.key | translate }} <span aria-hidden="true">▾</span>
              </button>
              <div class="nav-menu-items">
                @for (link of menu.links; track link.path) {
                  @if (!link.admin || auth.isAdmin()) {
                    <a
                      [routerLink]="link.path"
                      routerLinkActive="active"
                      (click)="openMenu.set(null)"
                      ><ab-icon [name]="link.icon" /> {{ 'nav.' + link.key | translate }}</a
                    >
                  }
                }
              </div>
            </div>
          }
        }
      </ab-header>
    }
    <main class="page"><router-outlet /></main>
    <app-toast />
  `,
})
export class App {
  readonly auth = inject(AuthService);
  readonly links = LINKS;
  readonly menus = MENUS;
  readonly openMenu = signal<MenuKey | null>(null);
  private readonly language = inject(LanguageService);
  private readonly router = inject(Router);
  // Read from the address bar first, so the header doesn't flash before the first navigation ends.
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: new URL(inject(BrowserLocation).href).pathname },
  );
  readonly isSharedRoute = computed(() => this.url().startsWith('/shared/'));
  constructor() {
    // A plain listener, not a host one: pointerover fires constantly and must not run change detection.
    const document = inject(DOCUMENT);
    document.addEventListener('pointerover', shuffleFoil);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('pointerover', shuffleFoil));
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

  toggleMenu(menu: MenuKey): void {
    this.openMenu.update((open) => (open === menu ? null : menu));
  }

  closeMenuOutside(event: Event): void {
    if (!(event.target as Element).closest?.('.nav-menu')) this.openMenu.set(null);
  }
}
