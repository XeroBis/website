import { computed, linkedSignal, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject, Subscription, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { Icon, IconName } from '@shared';
import {
  Card,
  SetOption,
  VARIANT_BADGES,
  VARIANT_LABELS,
  VariantType,
} from '../../../models/card.model';
import { SaleListCard, SaleListDetail } from '../../../models/sale-list.model';
import { CardsService } from '../../../services/cards.service';
import { CatalogService } from '../../../services/catalog.service';
import { SaleListsService } from '../../../services/sale-lists.service';
import { ToastService } from '../../../services/toast.service';
import {
  rarityCategories,
  rarityCategory,
  rawRaritiesForCategory,
  sortRarityCategories,
} from '../../../util/rarity-category.util';
import { rarityIconUrl } from '../../../util/rarity-icons.util';
import { togglePrintSelection } from '../../../util/variant-display.util';
import { variantIconUrl } from '../../../util/variant-icons.util';
import {
  CardOrder,
  orderCards,
  readStoredCardOrder,
  storeCardOrder,
} from '../../../util/card-order.util';
import { CardOrderComponent } from '../../shared/card-order/card-order.component';
import { ModalComponent } from '../../shared/modal/modal.component';
import {
  SearchableSelectComponent,
  SearchableSelectItem,
} from '../../shared/searchable-select/searchable-select.component';

type ListView = 'grid' | 'list' | 'sets';
const VIEW_STORAGE_KEY = 'saleListView';
const ORDER_STORAGE_KEY = 'saleListOrder';

function readStoredView(): ListView {
  try {
    const view = localStorage.getItem(VIEW_STORAGE_KEY);
    return view === 'list' || view === 'sets' ? view : 'grid';
  } catch {
    return 'grid';
  }
}

/** One catalog card in the grid views, with every print on sale. */
interface SaleTile {
  catalog_id: number;
  name: string;
  set_code: string;
  set_name: string;
  card_number: string;
  image_path: string;
  prints: { variant_type: VariantType; quantity: number }[];
}

/** A card waiting in the add modal's tray. */
interface TrayLine {
  key: number;
  card: Card;
  variant: VariantType;
  quantity: number;
}

/** Search results per request; more load while scrolling. */
const ADD_PAGE_SIZE = 60;

interface AddQuery {
  active: boolean;
  term: string;
  setCode: string;
  rarities: string[];
}

@Component({
  selector: 'app-sale-list-detail',
  imports: [
    Icon,
    CommonModule,
    FormsModule,
    RouterModule,
    CardOrderComponent,
    ModalComponent,
    SearchableSelectComponent,
    TranslatePipe,
  ],
  templateUrl: './sale-list-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The purchase list page's look, shared as is.
  styleUrl: '../../purchase-lists/purchase-list-detail/purchase-list-detail.component.scss',
})
export class SaleListDetailComponent implements OnInit, OnDestroy {
  saleList = signal<SaleListDetail | null>(null);
  loading = signal(false);
  /** Lines with a change in flight, so their controls wait for it. */
  pendingRows = signal(new Set<number>());
  editable = computed(() => !!this.saleList() && !this.saleList()!.sold_at);
  search = signal('');
  /** Icon filters, as on the set pages: an empty selection means all. */
  setFilter = signal(new Set<string>());
  printFilter = signal<VariantType[]>([]);
  rarityFilter = signal(new Set<string>());
  /** Set symbols by set code, for the set filter. */
  setSymbols = signal(new Map<string, string>());
  /** Grid (one tile per card), list (one editable row per print) or grid by
   * set. Remembered per browser. */
  view = signal<ListView>(readStoredView());
  readonly viewOptions: { view: ListView; icon: IconName; label: string }[] = [
    { view: 'grid', icon: 'grid', label: 'saleLists.detail.viewGrid' },
    { view: 'list', icon: 'list', label: 'saleLists.detail.viewList' },
    { view: 'sets', icon: 'layers', label: 'saleLists.detail.viewSets' },
  ];
  setOptions = computed(() => {
    const sets = new Map<string, string>();
    for (const card of this.saleList()?.cards ?? []) {
      sets.set(card.set_code, card.set_name);
    }
    return [...sets].map(([set_code, set_name]) => ({ set_code, set_name }));
  });
  printOptions = computed(() => [
    ...new Set((this.saleList()?.cards ?? []).map((card) => card.variant_type)),
  ]);
  rarityOptions = computed(() =>
    sortRarityCategories(
      new Set(
        (this.saleList()?.cards ?? []).flatMap((card) =>
          card.rarity ? [rarityCategory(card.rarity)] : [],
        ),
      ),
    ),
  );
  /** Number (the list's set-then-number order), name or quantity.
   * Remembered per browser. */
  order = signal<CardOrder>(readStoredCardOrder(ORDER_STORAGE_KEY));
  /** Line ids and catalog ids in the chosen order. Kept when only quantities
   * or prints change, so the line being edited doesn't jump away. */
  private ranks = linkedSignal<
    { cards: SaleListCard[]; order: CardOrder },
    { lines: Map<number, number>; tiles: Map<number, number> }
  >({
    source: () => ({ cards: this.saleList()?.cards ?? [], order: this.order() }),
    computation: ({ cards, order }, previous) => {
      const sameLines =
        !!previous &&
        previous.source.order === order &&
        previous.source.cards.length === cards.length &&
        cards.every((card) => previous.value.lines.has(card.id));
      if (sameLines) {
        return previous.value;
      }
      const lines = orderCards(cards, order, {
        name: (card) => card.name,
        quantity: (card) => card.quantity,
      });
      const tileCopies = new Map<number, number>();
      for (const card of cards) {
        tileCopies.set(card.catalog_id, (tileCopies.get(card.catalog_id) ?? 0) + card.quantity);
      }
      const tiles = orderCards(
        cards.filter(
          (card, index) => cards.findIndex((c) => c.catalog_id === card.catalog_id) === index,
        ),
        order,
        { name: (card) => card.name, quantity: (card) => tileCopies.get(card.catalog_id) ?? 0 },
      );
      return {
        lines: new Map(lines.map((card, index) => [card.id, index])),
        tiles: new Map(tiles.map((card, index) => [card.catalog_id, index])),
      };
    },
  });
  filteredCards = computed(() => {
    const term = this.search().trim().toLowerCase();
    const rank = this.ranks().lines;
    return (this.saleList()?.cards ?? [])
      .filter(
        (card) =>
          (!term || card.name.toLowerCase().includes(term)) &&
          (this.setFilter().size === 0 || this.setFilter().has(card.set_code)) &&
          (this.printFilter().length === 0 || this.printFilter().includes(card.variant_type)) &&
          (this.rarityFilter().size === 0 ||
            (!!card.rarity && this.rarityFilter().has(rarityCategory(card.rarity)))),
      )
      .sort((a, b) => (rank.get(a.id) ?? rank.size) - (rank.get(b.id) ?? rank.size));
  });
  /** filteredCards grouped by card (a card bought as standard and reverse is
   * one tile), in the chosen order. */
  tiles = computed(() => {
    const tiles = new Map<number, SaleTile>();
    for (const card of this.filteredCards()) {
      let tile = tiles.get(card.catalog_id);
      if (!tile) {
        tile = {
          catalog_id: card.catalog_id,
          name: card.name,
          set_code: card.set_code,
          set_name: card.set_name,
          card_number: card.card_number,
          image_path: card.image_path,
          prints: [],
        };
        tiles.set(card.catalog_id, tile);
      }
      tile.prints.push({ variant_type: card.variant_type, quantity: card.quantity });
    }
    // Prints in the catalog's display order (`variants` comes sorted).
    const order = new Map(
      this.filteredCards().map((card) => [card.catalog_id, card.variants] as const),
    );
    for (const tile of tiles.values()) {
      const variants = order.get(tile.catalog_id) ?? [];
      tile.prints.sort(
        (a, b) => variants.indexOf(a.variant_type) - variants.indexOf(b.variant_type),
      );
    }
    const rank = this.ranks().tiles;
    return [...tiles.values()].sort(
      (a, b) => (rank.get(a.catalog_id) ?? rank.size) - (rank.get(b.catalog_id) ?? rank.size),
    );
  });
  setGroups = computed(() => {
    const groups = new Map<
      string,
      { set_code: string; set_name: string; tiles: SaleTile[]; quantity: number }
    >();
    for (const tile of this.tiles()) {
      let group = groups.get(tile.set_code);
      if (!group) {
        group = { set_code: tile.set_code, set_name: tile.set_name, tiles: [], quantity: 0 };
        groups.set(tile.set_code, group);
      }
      group.tiles.push(tile);
      group.quantity += tile.prints.reduce((sum, print) => sum + print.quantity, 0);
    }
    // Sets stay in the list's order; the chosen order sorts within each.
    const setOrder = this.setOptions().map((set) => set.set_code);
    return [...groups.values()].sort(
      (a, b) => setOrder.indexOf(a.set_code) - setOrder.indexOf(b.set_code),
    );
  });
  readonly variantLabels = VARIANT_LABELS;
  readonly variantIcon = variantIconUrl;
  readonly rarityIcon = rarityIconUrl;

  sellOpen = signal(false);
  selling = signal(false);
  removeTarget = signal<SaleListCard | null>(null);
  removing = signal(false);

  addOpen = signal(false);
  addSearch = signal('');
  addResults = signal<Card[]>([]);
  addSearching = signal(false);
  /** Cards picked so far, added together by one click. */
  addTray = signal<TrayLine[]>([]);
  addTrayCopies = computed(() => this.addTray().reduce((sum, line) => sum + line.quantity, 0));
  /** Some print has more copies in the tray than can go on sale. */
  addTrayOver = computed(() =>
    this.addTray().some((line) => line.quantity > this.trayLineMax(line)),
  );
  adding = signal(false);
  private trayKey = 0;
  /** The add modal's set and rarity filters; any of them (or a 2+ letter
   * name) starts a search over the collection's cards with a copy outside
   * decks. */
  addSetCode = signal('');
  addRarities = signal<string[]>([]);
  collectionSets = signal<SetOption[]>([]);
  /** Rarity categories present in the collection. */
  addRarityOptions = signal<string[]>([]);
  addHasFilters = computed(() => !!this.addSetCode() || this.addRarities().length > 0);
  addSetItems = computed<SearchableSelectItem[]>(() =>
    this.collectionSets().map((set, index) => ({
      id: index,
      label: `${set.set_name} (${set.set_code})`,
    })),
  );
  addSetIndex = computed(() => {
    const index = this.collectionSets().findIndex((set) => set.set_code === this.addSetCode());
    return index < 0 ? null : index;
  });
  addActive = computed(() => this.addSearch().trim().length >= 2 || this.addHasFilters());
  /** Copies on every unsold list, by "catalog id|print", read when the add
   * modal opens. */
  onSale = signal(new Map<string, number>());
  private readonly addSearch$ = new Subject<AddQuery>();
  private addSearchSubscription?: Subscription;
  /** Matches in all, and the pages loaded so far (infinite scroll). */
  addTotal = signal(0);
  addLoadingMore = signal(false);
  private addPage = 1;
  /** The search the shown results answer, for loading its next pages. */
  private addLoadedQuery: AddQuery | null = null;
  private addMoreSubscription?: Subscription;
  private listId!: number;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly saleListsService: SaleListsService,
    private readonly catalogService: CatalogService,
    private readonly cardsService: CardsService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
  ) {}

  ngOnInit(): void {
    this.listId = Number(this.route.snapshot.paramMap.get('id'));
    this.load();
    this.catalogService.listSets().subscribe((sets) => {
      this.setSymbols.set(
        new Map(
          sets.flatMap((set) =>
            set.symbol_path
              ? [[set.set_code, this.catalogService.imageUrl(set.symbol_path)] as const]
              : [],
          ),
        ),
      );
    });
    this.addSearchSubscription = this.addSearch$
      .pipe(
        debounceTime(250),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        // An inactive query cancels the request in flight; a failed one keeps
        // the stream alive for the next change.
        switchMap((query) =>
          !query.active
            ? of({ query, page: null })
            : this.fetchAddPage(query, 1).pipe(map((page) => ({ query, page }))),
        ),
      )
      .subscribe(({ query, page }) => {
        this.addSearching.set(false);
        this.addResults.set(page?.items ?? []);
        this.addTotal.set(page?.total ?? 0);
        this.addPage = 1;
        this.addLoadedQuery = page ? query : null;
      });
  }

  ngOnDestroy(): void {
    this.addSearchSubscription?.unsubscribe();
    this.addMoreSubscription?.unsubscribe();
  }

  load(): void {
    this.loading.set(true);
    this.saleListsService.get(this.listId).subscribe({
      next: (detail) => {
        this.saleList.set(detail);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toastService.show(this.translate.instant('saleLists.detail.loadFailed'), 'error');
        this.router.navigate(['/sale-lists']);
      },
    });
  }

  clearRarities(): void {
    this.rarityFilter.set(new Set());
  }

  toggleRarity(rarity: string): void {
    this.rarityFilter.update((selected) => {
      const next = new Set(selected);
      if (next.has(rarity)) {
        next.delete(rarity);
      } else {
        next.add(rarity);
      }
      return next;
    });
  }

  togglePrint(variant: VariantType | 'all'): void {
    this.printFilter.update((selected) => togglePrintSelection(selected, variant));
  }

  /** A rarity with no icon yet shows its name instead. */
  onIconError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    img.nextElementSibling?.classList.add('visible');
  }

  clearSets(): void {
    this.setFilter.set(new Set());
  }

  toggleSet(setCode: string): void {
    this.setFilter.update((selected) => {
      const next = new Set(selected);
      if (next.has(setCode)) {
        next.delete(setCode);
      } else {
        next.add(setCode);
      }
      return next;
    });
  }

  setOrder(order: CardOrder): void {
    this.order.set(order);
    storeCardOrder(ORDER_STORAGE_KEY, order);
  }

  setView(view: ListView): void {
    this.view.set(view);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // Storage unavailable -- the choice just won't persist.
    }
  }

  /** "×2" for standard, "R×1" for reverse, the print's badge otherwise. */
  printBadge(variant: VariantType): string {
    return VARIANT_BADGES[variant] ?? '';
  }

  imageUrl(imagePath: string): string {
    return this.catalogService.thumbnailUrl(imagePath);
  }

  // ── lines ──────────────────────────────────────────────────────────────────

  changeQuantity(card: SaleListCard, delta: number): void {
    const quantity = card.quantity + delta;
    if (quantity >= 1) {
      this.saveLine(card, card.variant_type, quantity);
    }
  }

  changeVariant(card: SaleListCard, variant: VariantType): void {
    if (variant !== card.variant_type) {
      this.saveLine(card, variant, card.quantity);
    }
  }

  private saveLine(card: SaleListCard, variant: VariantType, quantity: number): void {
    this.setPending(card.id, true);
    this.saleListsService.updateCard(this.listId, card.id, variant, quantity).subscribe({
      next: (detail) => {
        this.setPending(card.id, false);
        this.saleList.set(detail);
      },
      error: (err) => {
        this.setPending(card.id, false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('saleLists.detail.updateFailed'),
          'error',
        );
      },
    });
  }

  private setPending(rowId: number, pending: boolean): void {
    this.pendingRows.update((rows) => {
      const next = new Set(rows);
      if (pending) {
        next.add(rowId);
      } else {
        next.delete(rowId);
      }
      return next;
    });
  }

  openRemoveConfirm(card: SaleListCard): void {
    this.removeTarget.set(card);
  }

  closeRemoveConfirm(): void {
    if (!this.removing()) {
      this.removeTarget.set(null);
    }
  }

  confirmRemove(): void {
    const target = this.removeTarget();
    if (!target) {
      return;
    }
    this.removing.set(true);
    this.saleListsService.removeCard(this.listId, target.id).subscribe({
      next: () => {
        this.removing.set(false);
        this.removeTarget.set(null);
        this.toastService.show(this.translate.instant('saleLists.detail.removed'));
        this.load();
      },
      error: (err) => {
        this.removing.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('saleLists.detail.removeFailed'),
          'error',
        );
      },
    });
  }

  // ── add from the collection ────────────────────────────────────────────────

  /** Copies of a print not in a normal deck nor on an unsold sale list. */
  sellable(card: Card, variant: VariantType): number {
    const owned = card.variants.find((v) => v.variant_type === variant)?.quantity ?? 0;
    const inDecks = card.allocated_variants[variant] ?? 0;
    const onSale = this.onSale().get(`${card.catalog_id}|${variant}`) ?? 0;
    return Math.max(owned - inDecks - onSale, 0);
  }

  openAdd(): void {
    this.addSearch.set('');
    this.addResults.set([]);
    this.addTray.set([]);
    this.addSetCode.set('');
    this.addRarities.set([]);
    this.addSearching.set(false);
    this.addSearch$.next(this.addQuery());
    this.addOpen.set(true);
    this.saleListsService
      .onSale()
      .subscribe((prints) =>
        this.onSale.set(
          new Map(prints.map((p) => [`${p.catalog_id}|${p.variant_type}`, p.quantity] as const)),
        ),
      );
    if (this.collectionSets().length === 0) {
      this.cardsService.filterOptions().subscribe((options) => {
        this.collectionSets.set(options.sets);
        this.addRarityOptions.set(rarityCategories(options.rarities));
      });
    }
  }

  closeAdd(): void {
    if (!this.adding()) {
      this.addOpen.set(false);
    }
  }

  onAddSearchChange(term: string): void {
    this.addSearch.set(term);
    this.runAddSearch();
  }

  setAddSet(index: number | null): void {
    this.addSetCode.set(index === null ? '' : (this.collectionSets()[index]?.set_code ?? ''));
    this.runAddSearch();
  }

  toggleAddRarity(category: string): void {
    this.addRarities.update((selected) =>
      selected.includes(category)
        ? selected.filter((value) => value !== category)
        : [...selected, category],
    );
    this.runAddSearch();
  }

  clearAddFilters(): void {
    this.addSetCode.set('');
    this.addRarities.set([]);
    this.runAddSearch();
  }

  private addQuery(): AddQuery {
    return {
      active: this.addActive(),
      term: this.addSearch().trim(),
      setCode: this.addSetCode(),
      rarities: this.addRarities(),
    };
  }

  /** One page of the add modal's search; a failed one gives null. */
  private fetchAddPage(query: AddQuery, page: number) {
    return this.cardsService
      .search({
        search: query.term || undefined,
        setCode: query.setCode || undefined,
        rarity: query.rarities.length ? query.rarities.flatMap(rawRaritiesForCategory) : undefined,
        available: 'available',
        sort: query.setCode ? 'card_number_asc' : 'name_asc',
        page,
        pageSize: ADD_PAGE_SIZE,
      })
      .pipe(catchError(() => of(null)));
  }

  /** Near the bottom of the results, the next page is appended. */
  onAddResultsScroll(event: Event): void {
    const box = event.target as HTMLElement;
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 200) {
      this.loadMoreAddResults();
    }
  }

  private loadMoreAddResults(): void {
    const query = this.addLoadedQuery;
    if (
      !query ||
      this.addSearching() ||
      this.addLoadingMore() ||
      this.addResults().length >= this.addTotal()
    ) {
      return;
    }
    this.addLoadingMore.set(true);
    this.addMoreSubscription = this.fetchAddPage(query, this.addPage + 1).subscribe((page) => {
      this.addLoadingMore.set(false);
      if (!page) {
        return;
      }
      this.addPage = page.page;
      // A card already shown (the list shifted between pages) stays once.
      const shown = new Set(this.addResults().map((card) => card.id));
      this.addResults.update((results) => [
        ...results,
        ...page.items.filter((card) => !shown.has(card.id)),
      ]);
    });
  }

  private runAddSearch(): void {
    // A page still loading belongs to the previous search.
    this.addMoreSubscription?.unsubscribe();
    this.addLoadingMore.set(false);
    this.addLoadedQuery = null;
    // The previous results stay (dimmed) until the new ones arrive.
    this.addSearching.set(this.addActive());
    this.addSearch$.next(this.addQuery());
  }

  /** Copies of a print the tray holds, leaving out one line. */
  private inTray(catalogId: number, variant: VariantType, except?: number): number {
    return this.addTray()
      .filter(
        (line) =>
          line.key !== except && line.card.catalog_id === catalogId && line.variant === variant,
      )
      .reduce((sum, line) => sum + line.quantity, 0);
  }

  /** Copies a line can hold: sellable minus the tray's other lines of that
   * print. */
  trayLineMax(line: TrayLine): number {
    return Math.max(
      this.sellable(line.card, line.variant) -
        this.inTray(line.card.catalog_id, line.variant, line.key),
      0,
    );
  }

  /** The prints a line can switch to: the card's with a copy to sell. */
  trayPrints(line: TrayLine): { variant_type: VariantType; sellable: number }[] {
    return line.card.variants
      .map((variant) => ({
        variant_type: variant.variant_type,
        sellable: this.sellable(line.card, variant.variant_type),
      }))
      .filter((choice) => choice.sellable > 0 || choice.variant_type === line.variant);
  }

  /** A result's prints with a copy left to sell (or already in the tray),
   * for its print icons. */
  resultPrints(card: Card): { variant_type: VariantType; left: number; inTray: number }[] {
    return card.variants
      .map((variant) => {
        const inTray = this.inTray(card.catalog_id, variant.variant_type);
        return {
          variant_type: variant.variant_type,
          left: Math.max(this.sellable(card, variant.variant_type) - inTray, 0),
          inTray,
        };
      })
      .filter((choice) => choice.left > 0 || choice.inTray > 0);
  }

  /** Into the tray, in its first print with a copy left; picked again, one
   * more copy of that print. */
  pickCard(card: Card): void {
    const variant = card.variants
      .map((v) => v.variant_type)
      .find((v) => this.sellable(card, v) - this.inTray(card.catalog_id, v) > 0);
    if (!variant) {
      this.toastService.show(this.translate.instant('saleLists.detail.nothingSellable'), 'error');
      return;
    }
    this.pickPrint(card, variant);
  }

  /** One more copy of that print in the tray: onto its line, else a new one,
   * so one card can sit in the tray in several prints. */
  pickPrint(card: Card, variant: VariantType): void {
    if (this.sellable(card, variant) - this.inTray(card.catalog_id, variant) <= 0) {
      return;
    }
    const existing = this.addTray().find(
      (line) => line.card.catalog_id === card.catalog_id && line.variant === variant,
    );
    if (existing) {
      this.updateTrayLine(existing.key, { quantity: existing.quantity + 1 });
    } else {
      this.addTray.update((tray) => [...tray, { key: ++this.trayKey, card, variant, quantity: 1 }]);
    }
  }

  /** A print switched to one the card already has a line in merges the two
   * lines (as in the list view). */
  updateTrayLine(key: number, patch: Partial<Pick<TrayLine, 'variant' | 'quantity'>>): void {
    if (patch.quantity !== undefined) {
      // A cleared or fractional input still means at least one copy.
      patch = { ...patch, quantity: Math.max(1, Math.floor(Number(patch.quantity) || 1)) };
    }
    this.addTray.update((tray) => {
      const line = tray.find((l) => l.key === key);
      if (!line) {
        return tray;
      }
      const updated = { ...line, ...patch };
      const twin = tray.find(
        (l) =>
          l.key !== key &&
          l.card.catalog_id === updated.card.catalog_id &&
          l.variant === updated.variant,
      );
      if (twin) {
        updated.quantity += twin.quantity;
      }
      return tray
        .filter((l) => l !== twin)
        .map((l) => (l.key === key ? updated : l));
    });
  }

  removeTrayLine(key: number): void {
    this.addTray.update((tray) => tray.filter((line) => line.key !== key));
  }

  submitAdd(): void {
    const tray = this.addTray();
    if (tray.length === 0 || this.addTrayOver()) {
      return;
    }
    this.adding.set(true);
    this.saleListsService
      .addCards(
        this.listId,
        tray.map((line) => ({
          catalog_id: line.card.catalog_id,
          variant_type: line.variant,
          quantity: line.quantity,
        })),
      )
      .subscribe({
        next: (detail) => {
          this.adding.set(false);
          this.saleList.set(detail);
          this.addOpen.set(false);
          this.toastService.show(
            this.translate.instant('saleLists.detail.addedMany', { count: this.addTrayCopies() }),
          );
        },
        error: (err) => {
          this.adding.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('saleLists.detail.addFailed'),
            'error',
          );
        },
      });
  }

  // ── sell ───────────────────────────────────────────────────────────────────

  closeSell(): void {
    if (!this.selling()) {
      this.sellOpen.set(false);
    }
  }

  confirmSell(): void {
    this.selling.set(true);
    this.saleListsService.sell(this.listId).subscribe({
      next: (detail) => {
        this.selling.set(false);
        this.sellOpen.set(false);
        this.saleList.set(detail);
        this.toastService.show(this.translate.instant('saleLists.detail.soldToast'));
      },
      error: (err) => {
        this.selling.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('saleLists.detail.sellFailed'),
          'error',
        );
      },
    });
  }
}
