import { computed, linkedSignal, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject, Subscription, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { Icon, IconName } from '@shared';
import {
  CardCatalogEntry,
  CardSet,
  VARIANT_BADGES,
  VARIANT_LABELS,
  VariantType,
} from '../../../models/card.model';
import { PurchaseListCard, PurchaseListDetail } from '../../../models/purchase-list.model';
import { CatalogService } from '../../../services/catalog.service';
import { PurchaseListsService } from '../../../services/purchase-lists.service';
import { ToastService } from '../../../services/toast.service';
import {
  rarityCategories,
  rarityCategory,
  rawRaritiesForCategory,
  sortRarityCategories,
} from '../../../util/rarity-category.util';
import { rarityIconUrl } from '../../../util/rarity-icons.util';
import { isMainVariant, togglePrintSelection } from '../../../util/variant-display.util';
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
const VIEW_STORAGE_KEY = 'purchaseListView';
const ORDER_STORAGE_KEY = 'purchaseListOrder';

function readStoredView(): ListView {
  try {
    const view = localStorage.getItem(VIEW_STORAGE_KEY);
    return view === 'list' || view === 'sets' ? view : 'grid';
  } catch {
    return 'grid';
  }
}

/** One catalog card in the grid views, with every print it's bought in. */
interface PurchaseTile {
  catalog_id: number;
  name: string;
  set_code: string;
  set_name: string;
  card_number: string;
  image_path: string;
  prints: { variant_type: VariantType; quantity: number }[];
}

interface AddQuery {
  active: boolean;
  term: string;
  setCode: string;
  rarities: string[];
  prints: VariantType[];
}

@Component({
  selector: 'app-purchase-list-detail',
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
  templateUrl: './purchase-list-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './purchase-list-detail.component.scss',
})
export class PurchaseListDetailComponent implements OnInit, OnDestroy {
  purchaseList = signal<PurchaseListDetail | null>(null);
  loading = signal(false);
  /** Lines with a change in flight, so their controls wait for it. */
  pendingRows = signal(new Set<number>());
  editable = computed(() => !!this.purchaseList() && !this.purchaseList()!.received_at);
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
    { view: 'grid', icon: 'grid', label: 'purchaseLists.detail.viewGrid' },
    { view: 'list', icon: 'list', label: 'purchaseLists.detail.viewList' },
    { view: 'sets', icon: 'layers', label: 'purchaseLists.detail.viewSets' },
  ];
  setOptions = computed(() => {
    const sets = new Map<string, string>();
    for (const card of this.purchaseList()?.cards ?? []) {
      sets.set(card.set_code, card.set_name);
    }
    return [...sets].map(([set_code, set_name]) => ({ set_code, set_name }));
  });
  printOptions = computed(() => [
    ...new Set((this.purchaseList()?.cards ?? []).map((card) => card.variant_type)),
  ]);
  rarityOptions = computed(() =>
    sortRarityCategories(
      new Set(
        (this.purchaseList()?.cards ?? []).flatMap((card) =>
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
    { cards: PurchaseListCard[]; order: CardOrder },
    { lines: Map<number, number>; tiles: Map<number, number> }
  >({
    source: () => ({ cards: this.purchaseList()?.cards ?? [], order: this.order() }),
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
    return (this.purchaseList()?.cards ?? [])
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
    const tiles = new Map<number, PurchaseTile>();
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
      { set_code: string; set_name: string; tiles: PurchaseTile[]; quantity: number }
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

  receiveOpen = signal(false);
  receiving = signal(false);
  removeTarget = signal<PurchaseListCard | null>(null);
  removing = signal(false);

  addOpen = signal(false);
  addSearch = signal('');
  addResults = signal<CardCatalogEntry[]>([]);
  addSearching = signal(false);
  addPicked = signal<CardCatalogEntry | null>(null);
  addVariant = signal<VariantType>('standard');
  addQuantity = signal(1);
  adding = signal(false);
  /** The add modal's catalog filters; any of them (or a 2+ letter name)
   * starts a search. */
  addSetCode = signal('');
  addRarities = signal<string[]>([]);
  addPrints = signal<VariantType[]>([]);
  addRarityOptions = signal<string[]>([]);
  addPrintOptions = signal<VariantType[]>([]);
  /** The other prints (stamps, holos, staff…) stay behind a "+N" button. */
  addShowAllPrints = signal(false);
  addShownPrints = computed(() =>
    this.addShowAllPrints()
      ? this.addPrintOptions()
      : this.addPrintOptions().filter((v) => isMainVariant(v) || this.addPrints().includes(v)),
  );
  addHiddenPrintCount = computed(
    () => this.addPrintOptions().length - this.addShownPrints().length,
  );
  catalogSets = signal<CardSet[]>([]);
  addSetItems = computed<SearchableSelectItem[]>(() =>
    this.catalogSets().map((set, index) => ({
      id: index,
      label: `${set.set_name} (${set.set_code})`,
    })),
  );
  addSetIndex = computed(() => {
    const index = this.catalogSets().findIndex((set) => set.set_code === this.addSetCode());
    return index < 0 ? null : index;
  });
  addHasFilters = computed(
    () => !!this.addSetCode() || this.addRarities().length > 0 || this.addPrints().length > 0,
  );
  addActive = computed(() => this.addSearch().trim().length >= 2 || this.addHasFilters());
  private addOptionsLoaded = false;
  private readonly addSearch$ = new Subject<AddQuery>();
  private addSearchSubscription?: Subscription;
  private listId!: number;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly purchaseListsService: PurchaseListsService,
    private readonly catalogService: CatalogService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
  ) {}

  ngOnInit(): void {
    this.listId = Number(this.route.snapshot.paramMap.get('id'));
    this.load();
    this.catalogService.listSets().subscribe((sets) => {
      this.catalogSets.set(sets);
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
            ? of(null)
            : this.catalogService
                .browse({
                  search: query.term || undefined,
                  setCode: query.setCode || undefined,
                  rarity: query.rarities.length
                    ? query.rarities.flatMap(rawRaritiesForCategory)
                    : undefined,
                  variantType: query.prints.length ? query.prints : undefined,
                  sort: query.setCode ? 'card_number_asc' : 'name_asc',
                  pageSize: 60,
                })
                .pipe(catchError(() => of(null))),
        ),
      )
      .subscribe((page) => {
        this.addSearching.set(false);
        this.addResults.set(page?.items ?? []);
      });
  }

  ngOnDestroy(): void {
    this.addSearchSubscription?.unsubscribe();
  }

  load(): void {
    this.loading.set(true);
    this.purchaseListsService.get(this.listId).subscribe({
      next: (detail) => {
        this.purchaseList.set(detail);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toastService.show(this.translate.instant('purchaseLists.detail.loadFailed'), 'error');
        this.router.navigate(['/purchase-lists']);
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

  changeQuantity(card: PurchaseListCard, delta: number): void {
    const quantity = card.quantity + delta;
    if (quantity >= 1) {
      this.saveLine(card, card.variant_type, quantity);
    }
  }

  changeVariant(card: PurchaseListCard, variant: VariantType): void {
    if (variant !== card.variant_type) {
      this.saveLine(card, variant, card.quantity);
    }
  }

  private saveLine(card: PurchaseListCard, variant: VariantType, quantity: number): void {
    this.setPending(card.id, true);
    this.purchaseListsService.updateCard(this.listId, card.id, variant, quantity).subscribe({
      next: (detail) => {
        this.setPending(card.id, false);
        this.purchaseList.set(detail);
      },
      error: (err) => {
        this.setPending(card.id, false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('purchaseLists.detail.updateFailed'),
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

  openRemoveConfirm(card: PurchaseListCard): void {
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
    this.purchaseListsService.removeCard(this.listId, target.id).subscribe({
      next: () => {
        this.removing.set(false);
        this.removeTarget.set(null);
        this.toastService.show(this.translate.instant('purchaseLists.detail.removed'));
        this.load();
      },
      error: (err) => {
        this.removing.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('purchaseLists.detail.removeFailed'),
          'error',
        );
      },
    });
  }

  // ── add by hand ────────────────────────────────────────────────────────────

  openAdd(): void {
    this.addSearch.set('');
    this.addResults.set([]);
    this.addPicked.set(null);
    this.addQuantity.set(1);
    this.addSetCode.set('');
    this.addRarities.set([]);
    this.addPrints.set([]);
    this.addShowAllPrints.set(false);
    this.addSearching.set(false);
    this.addSearch$.next(this.addQuery());
    this.addOpen.set(true);
    if (!this.addOptionsLoaded) {
      this.addOptionsLoaded = true;
      this.catalogService
        .listRarities()
        .subscribe((rarities) => this.addRarityOptions.set(rarityCategories(rarities)));
      this.catalogService
        .listVariantTypes()
        .subscribe((types) => this.addPrintOptions.set(['standard', ...types]));
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
    this.addSetCode.set(index === null ? '' : (this.catalogSets()[index]?.set_code ?? ''));
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

  toggleAddPrint(variant: VariantType): void {
    this.addPrints.update((selected) =>
      selected.includes(variant)
        ? selected.filter((value) => value !== variant)
        : [...selected, variant],
    );
    this.runAddSearch();
  }

  clearAddFilters(): void {
    this.addSetCode.set('');
    this.addRarities.set([]);
    this.addPrints.set([]);
    this.runAddSearch();
  }

  private addQuery(): AddQuery {
    return {
      active: this.addActive(),
      term: this.addSearch().trim(),
      setCode: this.addSetCode(),
      rarities: this.addRarities(),
      prints: this.addPrints(),
    };
  }

  private runAddSearch(): void {
    // The previous results stay (dimmed) until the new ones arrive, so the
    // list doesn't empty and refill on every change.
    this.addSearching.set(this.addActive());
    this.addSearch$.next(this.addQuery());
  }

  pickCard(card: CardCatalogEntry): void {
    this.addPicked.set(card);
    // The one print filtered on, when the card comes in it.
    const [print] = this.addPrints();
    const preselect =
      this.addPrints().length === 1 && card.variants?.some((v) => v.variant_type === print);
    this.addVariant.set(preselect ? print : 'standard');
  }

  submitAdd(): void {
    const card = this.addPicked();
    if (!card) {
      return;
    }
    this.adding.set(true);
    this.purchaseListsService
      .addCard(this.listId, card.id, this.addVariant(), Math.max(1, this.addQuantity()))
      .subscribe({
        next: (detail) => {
          this.adding.set(false);
          this.purchaseList.set(detail);
          this.addOpen.set(false);
          this.toastService.show(this.translate.instant('purchaseLists.detail.added'));
        },
        error: (err) => {
          this.adding.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('purchaseLists.detail.addFailed'),
            'error',
          );
        },
      });
  }

  // ── receive ────────────────────────────────────────────────────────────────

  closeReceive(): void {
    if (!this.receiving()) {
      this.receiveOpen.set(false);
    }
  }

  confirmReceive(): void {
    this.receiving.set(true);
    this.purchaseListsService.receive(this.listId).subscribe({
      next: (detail) => {
        this.receiving.set(false);
        this.receiveOpen.set(false);
        this.purchaseList.set(detail);
        this.toastService.show(this.translate.instant('purchaseLists.detail.receivedToast'));
      },
      error: (err) => {
        this.receiving.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('purchaseLists.detail.receiveFailed'),
          'error',
        );
      },
    });
  }
}
