import {
  HttpInterceptorFn,
  HttpResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter, RouteReuseStrategy, TitleStrategy } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { AuthService, LanguageService, provideI18n, User } from '@shared';
import en from '../i18n/en.json';
import fr from '../i18n/fr.json';
import { routes } from './app.routes';
import { App } from './app';
import { CardsRouteReuseStrategy } from './language-routes';
import { TranslatedTitleStrategy } from './title-strategy';
import { DeckDetailComponent } from './components/deck/deck-detail/deck-detail.component';
import { CombatsComponent } from './components/combats/combats.component';
import { By } from '@angular/platform-browser';
import { BrowseComponent } from './components/browse/browse.component';
import { ShoppingListDetailComponent } from './components/shopping-lists/shopping-list-detail/shopping-list-detail.component';

const user: User = {
  id: 1,
  email: 'test@example.com',
  pseudo: 'Player',
  language: 'en',
  theme: 'system',
  is_admin: true,
  apps: ['cards'],
};
const card = {
  id: 1,
  name: 'Pikachu',
  set_name: 'Base',
  set_name_fr: null,
  set_code: 'BS',
  card_number: '1',
  image_path: 'Base/BS/cards/1_EN.jpg',
  rarity: 'Common',
  supertype: 'Pokémon',
  series: 'Base',
  card_count: 102,
  release_date: '1999-01-09',
  source_url: null,
  created_at: '',
  variants: [{ variant_type: 'standard' as const, image_path_fr: null, image_path_us: null }],
  details: null,
};
const owned = {
  ...card,
  id: 11,
  catalog_id: 1,
  quantity: 3,
  allocated: 1,
  available: 2,
  allocated_variants: { standard: 1 },
  variants: [{ variant_type: 'standard', quantity: 3, image_path_fr: null, image_path_us: null }],
  decks: [],
};
const row = {
  id: 91,
  card_id: 11,
  catalog_id: 1,
  variant_type: 'standard',
  quantity_in_deck: 1,
  poster_slot: null,
  name: 'Pikachu',
  set_name: 'Base',
  set_code: 'BS',
  card_number: '1',
  image_path: card.image_path,
  supertype: 'Pokémon',
  available: 2,
  owned: null,
  allocated_decks: [],
};
const deck = {
  id: 5,
  name: 'Lightning',
  description: null,
  deck_type: 'normal',
  has_wdc_cards: false,
  created_at: '',
  total_cards: 1,
  poster_cards: [],
  cards: [row],
};
const set = {
  set_code: 'BS',
  set_name: 'Base',
  set_name_fr: null,
  series: 'Base',
  series_display_name: 'Base',
  card_count: 102,
  release_date: null,
  logo_path: null,
  logo_path_fr: null,
  symbol_path: null,
  completion_percent: 1,
};
const listCard = {
  id: 1,
  catalog_id: 1,
  name: 'Pikachu',
  name_en: 'Pikachu',
  name_fr: 'Pikachu FR',
  set_name: 'Base',
  set_code: 'BS',
  card_number: '1',
  image_path: card.image_path,
  supertype: 'Pokémon',
  quantity_needed: 2,
  quantity_owned: 1,
};
const list = {
  id: 7,
  name: 'Wanted',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  total_cards: 1,
  total_quantity_needed: 2,
  fully_got_cards: 0,
  cards: [listCard],
};
const status = {
  status: 'idle',
  step: null,
  step_label: null,
  step_index: 0,
  total_steps: 0,
  percent: 0,
  sub_done: 0,
  sub_total: 0,
  result: {},
  error: null,
  last_run_at: null,
  last_run_result: null,
};
const authState = signal<User | null>(user);
const requests: string[] = [];
const backend: HttpInterceptorFn = (request) => {
  requests.push(request.url);
  const path = request.url.replace('/api/cards', '');
  let body: unknown = [];
  if (path === '/catalog') body = { total: 1, page: 1, page_size: 100, items: [card] };
  else if (path === '/catalog/sets') body = [set];
  else if (path === '/catalog/sets/BS/cards') body = [card];
  else if (path === '/catalog/1') body = card;
  else if (path === '/catalog/1/variants') body = card.variants;
  else if (path.endsWith('/deck-usage')) body = { allocated_decks: [], phantom_decks: [] };
  else if (path === '/collection/search')
    body = {
      total: 1,
      page: 1,
      page_size: 100,
      total_quantity: 3,
      collection_total_quantity: 3,
      items: [owned],
    };
  else if (path === '/collection/filter-options')
    body = { sets: [set], rarities: ['Common'], owned_variant_types: [] };
  else if (path === '/collection') body = [owned];
  else if (path === '/decks') body = [deck];
  else if (path === '/decks/5') body = deck;
  else if (path === '/decks/6')
    body = {
      ...deck,
      id: 6,
      deck_type: 'phantom',
      cards: [{ ...row, card_id: null, owned: 0, quantity_in_deck: 3 }],
    };
  else if (path === '/combats')
    body = [
      {
        id: 1,
        deck_a_id: 5,
        deck_a_name: 'Lightning',
        player_a_id: 1,
        player_a_pseudo: 'Player',
        deck_b_id: null,
        deck_b_name: 'Deleted deck',
        player_b_id: 1,
        player_b_pseudo: 'Player',
        winner: 'a',
        loser_score: 2,
        played_at: '2026-10-18',
        created_at: '',
        deck_a_snapshot: [row],
        deck_b_snapshot: [],
      },
    ];
  else if (path === '/purchases')
    body = [
      {
        id: 1,
        product_name: 'Booster',
        price: '12.50',
        quantity: 1,
        purchased_at: '2026-10-18',
        source: null,
        description: null,
        sets: ['BS'],
        created_at: '',
      },
    ];
  else if (path === '/users') body = [{ id: 1, pseudo: 'Player' }];
  else if (path === '/shopping-lists') body = [list];
  else if (path === '/shopping-lists/7') body = list;
  else if (path === '/shopping-lists/7/cards/1')
    body = {
      ...listCard,
      quantity_owned: request.body && (request.body as { quantity_owned: number }).quantity_owned,
    };
  else if (path === '/public/shares/token')
    body = {
      set_code: 'BS',
      set_name: 'Base',
      series: 'Base',
      card_count: 102,
      release_date: null,
      expires_at: '2026-12-01',
      cards: [
        { ...card, quantity_owned: 3, variants: owned.variants, print_variants: card.variants },
      ],
    };
  else if (path === '/catalog/stats')
    body = {
      total_cards: 1,
      total_sets: 1,
      distinct_card_names: 1,
      variant_counts: { standard: 1 },
    };
  else if (path.endsWith('/status')) body = status;
  else if (path === '/catalog/rarities') body = ['Common'];
  return of(new HttpResponse({ body }));
};

async function setup() {
  authState.set(user);
  localStorage.clear();
  requests.length = 0;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      { provide: RouteReuseStrategy, useClass: CardsRouteReuseStrategy },
      { provide: TitleStrategy, useClass: TranslatedTitleStrategy },
      provideHttpClient(withInterceptors([backend])),
      provideI18n({ en, fr }),
      {
        provide: AuthService,
        useValue: {
          user: authState,
          isAdmin: signal(true),
          isLoggedIn: signal(true),
          canUse: () => true,
          load: async () => authState(),
          updateLanguage: async (language: 'en' | 'fr') => {
            const updated = { ...user, language };
            authState.set(updated);
            return updated;
          },
        },
      },
    ],
  });
  return RouterTestingHarness.create();
}

describe('Cards standalone zoneless pages', () => {
  for (const [url, text] of [
    ['/browse', 'Pikachu'],
    ['/sets', 'Base'],
    ['/sets/BS', 'Base'],
    ['/collection', 'Pikachu'],
    ['/missing', 'Missing'],
    ['/decks', 'Lightning'],
    ['/decks/5', 'Lightning'],
    ['/combats', 'Player'],
    ['/purchases', 'Booster'],
    ['/shopping-lists', 'Wanted'],
    ['/shopping-lists/7', 'Wanted'],
    ['/shares', 'Shares'],
    ['/convert', 'Convert'],
    ['/gestion', 'Collection'],
    ['/catalog-management', 'Catalog'],
    ['/shared/token', 'Base'],
  ]) {
    it(`renders ${url} from the new API contract`, async () => {
      const harness = await setup();
      await harness.navigateByUrl(url);
      await harness.fixture.whenStable();
      expect(harness.routeNativeElement?.textContent).toContain(text);
    });
  }

  it('reacts to staging changes and HTTP results without manual change detection', async () => {
    const harness = await setup();
    const page = await harness.navigateByUrl('/browse', BrowseComponent);
    await harness.fixture.whenStable();
    page.addToCollection(card);
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.textContent).toContain('Pikachu');
    expect(requests).toContain('/api/cards/catalog/1/variants');
    page.openDetail(card);
    await harness.fixture.whenStable();
    expect(harness.routeNativeElement?.querySelector('app-card-detail')).toBeTruthy();
  });

  it('uses both shopping-list names and updates the tally from the response', async () => {
    const harness = await setup();
    const page = await harness.navigateByUrl('/shopping-lists/7', ShoppingListDetailComponent);
    expect(page.displayName(listCard)).toBe('Pikachu');
    page.nameLanguage.set('fr');
    expect(page.displayName(listCard)).toBe('Pikachu FR');
    page.changeQuantityOwned(listCard, 1);
    await harness.fixture.whenStable();
    expect(page.shoppingList()?.fully_got_cards).toBe(1);
    expect(page.shoppingList()?.cards[0].quantity_owned).toBe(2);
  });

  it('keeps the public shared set outside appGuard and uses only public data routes', async () => {
    const harness = await setup();
    authState.set(null);
    await harness.navigateByUrl('/shared/token');
    const images = [...harness.routeNativeElement!.querySelectorAll('img')].map((img) =>
      img.getAttribute('src'),
    );
    expect(requests.filter((url) => url.startsWith('/api/cards'))).toEqual([
      '/api/cards/public/shares/token',
    ]);
    expect(
      images
        .filter((url) => url?.includes('/api/cards/'))
        .every((url) => url?.startsWith('/api/cards/public/')),
    ).toBe(true);
    const publicRoute = routes.find((r) => r.path === 'shared/:token');
    expect(publicRoute?.canActivate).toBeUndefined();
    expect(
      routes.find((r) => r.path === '')?.children?.find((r) => r.path === 'catalog-management')
        ?.canActivate?.length,
    ).toBe(1);
  });

  it('shows the shared header with app navigation', async () => {
    await setup();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('ab-header')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('a[href="/shares"]')).toBeTruthy();
  });
  it("groups the old app's pages into dropdown menus, opened one at a time", async () => {
    await setup();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const menus = [...el.querySelectorAll('.nav-menu')];
    expect(
      menus.map((m) => m.querySelector('button')?.textContent?.replace('▾', '').trim()),
    ).toEqual(['Play', 'Track', 'Tools', 'Manage']);
    expect([...menus[3].querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/catalog-management',
      '/gestion',
    ]);
    menus[0].querySelector('button')!.click();
    await fixture.whenStable();
    expect(menus[0].classList).toContain('open');
    menus[1].querySelector('button')!.click();
    await fixture.whenStable();
    expect(menus[0].classList).not.toContain('open');
    expect(menus[1].classList).toContain('open');
    document.body.click();
    await fixture.whenStable();
    expect(menus[1].classList).not.toContain('open');
  });
  it('names the tab after the page and the app, in the current language', async () => {
    await setup();
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/decks/5');
    await fixture.whenStable();
    expect(document.title).toBe('Decks · Pokemon Card Collection');
    expect(fixture.nativeElement.querySelector('ab-header .title')?.textContent).toBe(
      'Pokemon Card Collection',
    );
    await TestBed.inject(LanguageService).change('fr');
    await fixture.whenStable();
    await router.navigateByUrl('/sets');
    await fixture.whenStable();
    expect(document.title).toBe('Séries · Collection de cartes Pokémon');
    expect(fixture.nativeElement.querySelector('ab-header .title')?.textContent).toBe(
      'Collection de cartes Pokémon',
    );
  });
  it('hides the header on the public shared set', async () => {
    await setup();
    authState.set(null);
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/shared/token');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('ab-header')).toBeNull();
  });
  it('draws only real deck copies and renders the hand without a server request', async () => {
    const harness = await setup();
    const page = await harness.navigateByUrl('/decks/5', DeckDetailComponent);
    const before = requests.length;
    page.openStartHand();
    await harness.fixture.whenStable();
    expect(page.startHand()).toHaveLength(1);
    expect(page.startHand()[0].id).toBe(91);
    expect(harness.routeNativeElement?.querySelectorAll('.start-hand-card')).toHaveLength(1);
    expect(requests.length).toBe(before);
  });
  it('shows a phantom want-list without normal-deck draft controls', async () => {
    const harness = await setup();
    const page = await harness.navigateByUrl('/decks/6', DeckDetailComponent);
    expect(page.isPhantom).toBe(true);
    page.wantListFilter.set('missing');
    await harness.fixture.whenStable();
    expect(page.sortedCards).toHaveLength(1);
    expect(harness.routeNativeElement?.querySelector('app-deck-upgrade-drafts')).toBeNull();
  });
  it('allows editing a combat whose deck has been deleted', async () => {
    const harness = await setup();
    const page = await harness.navigateByUrl('/combats', CombatsComponent);
    const combat = page.combats()[0];
    page.openEdit(combat);
    page.submitEdit();
    expect(requests).toContain('/api/cards/combats/1');
  });
  it('reloads server-localized data after the shared language switch saves the account', async () => {
    await setup();
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/browse');
    await fixture.whenStable();
    const before = fixture.debugElement.query(By.directive(BrowseComponent)).componentInstance;
    await TestBed.inject(LanguageService).change('fr');
    await fixture.whenStable();
    const after = fixture.debugElement.query(By.directive(BrowseComponent)).componentInstance;
    expect(after).not.toBe(before);
    expect(authState()?.language).toBe('fr');
    expect(fixture.nativeElement.textContent).toContain('Collection');
  });
});
