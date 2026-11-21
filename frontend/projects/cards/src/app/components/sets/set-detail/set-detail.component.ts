import { Icon } from '@shared';
import { computed, signal } from '@angular/core';
import { SetFiltersComponent } from '../set-filters/set-filters.component';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { forkJoin, Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import {
  Card,
  CardCatalogEntry,
  CardCatalogVariant,
  CardSet,
  SHARE_DURATION_OPTIONS,
  Share,
  VARIANT_LABELS,
  VariantType,
} from '../../../models/card.model';
import { SaleList } from '../../../models/sale-list.model';
import { CardsService } from '../../../services/cards.service';
import { CountIncomingService } from '../../../services/count-incoming.service';
import { CountDeckCardsService } from '../../../services/count-deck-cards.service';
import { PurchaseListsService } from '../../../services/purchase-lists.service';
import { SaleListsService } from '../../../services/sale-lists.service';
import { variantIconUrl } from '../../../util/variant-icons.util';
import { CatalogService } from '../../../services/catalog.service';
import { SharesService } from '../../../services/shares.service';
import { ToastService } from '../../../services/toast.service';
import { CardDisplayNamePipe } from '../../../util/card-display-name.pipe';
import { matchesCatalogSearch, parseAnchoredSearch } from '../../../util/pokemon-translations.util';
import { rarityCategory, sortRarityCategories } from '../../../util/rarity-category.util';
import { rarityIconUrl } from '../../../util/rarity-icons.util';
import {
  DEFAULT_SET_RARITIES,
  DEFAULT_SET_VARIANTS,
  lacksDefaultRarities,
} from '../../../util/set-filter-defaults.util';
import { CardDetailComponent } from '../../shared/card-detail/card-detail.component';
import { CardOrderComponent } from '../../shared/card-order/card-order.component';
import {
  CardOrder,
  orderCards,
  readStoredCardOrder,
  storeCardOrder,
} from '../../../util/card-order.util';
import {
  SetCardGridComponent,
  SetGridAdapter,
  SetView,
} from '../set-card-grid/set-card-grid.component';
import { ModalComponent } from '../../shared/modal/modal.component';
import { MissingExportModalComponent } from '../missing-export-modal/missing-export-modal.component';
import {
  buildVariantTiles,
  completionPercent,
  VariantDisplayMode,
  printSelectionMode,
  selectDisplayedPrints,
  MinOwned,
  nextMinOwned,
} from '../../../util/variant-display.util';
const VIEW_STORAGE_KEY = 'setDetailView';
const ORDER_STORAGE_KEY = 'setDetailOrder';
const SALE_LIST_STORAGE_KEY = 'setDetailSaleList';
/** Copies of one print waiting in sale mode's tray. */
interface SaleTrayLine {
  entry: CardCatalogEntry;
  variant: VariantType;
  quantity: number;
}
function readStoredSaleList(): number | null {
  try {
    const id = Number(localStorage.getItem(SALE_LIST_STORAGE_KEY));
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
function readStoredView(): SetView {
  try {
    const view = localStorage.getItem(VIEW_STORAGE_KEY);
    return view === 'checklist' || view === 'binder' || view === 'binder12' ? view : 'grid';
  } catch {
    return 'grid';
  }
}
@Component({
  selector: 'app-set-detail',
  imports: [
    Icon,
    CommonModule,
    FormsModule,
    RouterLink,
    CardDetailComponent,
    CardOrderComponent,
    SetCardGridComponent,
    SetFiltersComponent,
    ModalComponent,
    MissingExportModalComponent,
    CardDisplayNamePipe,
    TranslatePipe,
  ],
  templateUrl: './set-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './set-detail.component.scss',
})
export class SetDetailComponent implements OnInit, OnDestroy {
  setCode = signal('');
  setName = signal('');
  cards = signal<CardCatalogEntry[]>([]);
  ownedCards = signal(new Map<number, Card>());
  /** Copies on incoming purchase lists, by catalog id then print. */
  incoming = signal(new Map<number, Map<VariantType, number>>());
  pendingIds = signal(new Set<number>());
  loading = signal(true);
  detailCard = signal<CardCatalogEntry | null>(null);
  exportModalOpen = signal(false);
  get exportVariantTypes(): VariantType[] {
    return [
      ...new Set(
        this.cards().flatMap((card) => card.variants.map((variant) => variant.variant_type)),
      ),
    ];
  }
  selectedVariants = signal<VariantType[]>([...DEFAULT_SET_VARIANTS]);
  onRaritiesChange(rarities: Set<string>): void {
    this.selectedRarities.set(rarities);
    this.recomputeFilteredCards();
  }
  onVariantsChange(variants: VariantType[]): void {
    this.selectedVariants.set(variants);
    this.variantDisplayMode.set(printSelectionMode(variants));
    this.recomputeFilteredCards();
  }
  search = signal('');
  selectedRarities = signal(new Set(DEFAULT_SET_RARITIES));
  missingOnly = signal(false);
  /** Owned filter (+0 = off, +1, +2), per print, over the copies the tile shows. */
  minOwned = signal<MinOwned>(0);
  /** Selected print controls the grid layout. */
  variantDisplayMode = signal<VariantDisplayMode>(printSelectionMode(this.selectedVariants()));
  /** Grid, checklist, or nine- or twelve-pocket binder. Remembered per browser. */
  view = signal<SetView>(readStoredView());
  /** Recomputed explicitly (debounced on filterChange$ for the search box)
   * rather than as a template getter -- see collection.component.ts's
   * filteredCards for why a getter re-run on every change-detection cycle
   * over the whole set was the cause of multi-second typing lag. */
  filteredCards = signal<CardCatalogEntry[]>([]);
  /** Number (the set's order), name or quantity. Remembered per browser. */
  order = signal<CardOrder>(readStoredCardOrder(ORDER_STORAGE_KEY));
  /** Only the logo/symbol paths matter here -- fetched via listSets() since
   * GET /api/cards/catalog/sets/{code}/cards doesn't carry them (see main.py's
   * /api/cards/images/ mount and GET /api/cards/catalog/sets's docstring). */
  setInfo = signal<Pick<CardSet, 'logo_path' | 'logo_path_fr' | 'symbol_path'> | null>(null);
  private readonly filterChange$ = new Subject<void>();
  private filterChangeSubscription?: Subscription;
  shareModalOpen = signal(false);
  readonly variantLabels = VARIANT_LABELS;
  readonly variantIcon = variantIconUrl;
  /** "Put up for sale": the tiles' − and + fill the tray instead of the collection. */
  saleMode = signal(false);
  /** The user's lists still on sale, newest first. */
  saleLists = signal<SaleList[]>([]);
  saleListId = signal<number | null>(null);
  /** Copies on unsold sale lists, by catalog id then print. */
  onSale = signal(new Map<number, Map<VariantType, number>>());
  saleTray = signal<SaleTrayLine[]>([]);
  saleTrayCopies = computed(() => this.saleTray().reduce((sum, line) => sum + line.quantity, 0));
  /** The inline "New list…" name, null while hidden. */
  newSaleListName = signal<string | null>(null);
  saleBusy = signal(false);
  saleExitConfirmOpen = signal(false);
  /** The "sell the extras" confirmation, with what it would add. */
  extrasConfirm = signal<{ catalog_id: number; variant_type: VariantType; quantity: number }[] | null>(
    null,
  );
  /** Phones: the panel is a bottom bar, opened by its header. */
  salePanelExpanded = signal(false);
  shareDurationOptions = signal(SHARE_DURATION_OPTIONS);
  shareDurationDays = signal(7);
  creatingShare = signal(false);
  createdShare = signal<Share | null>(null);
  readonly gridAdapter: SetGridAdapter<CardCatalogEntry> = {
    variants: (card) => this.displayedVariants(card),
    number: (card) => this.cardNumberLabel(card),
    secret: (card) => this.isSecretNumber(card),
    image: (card, variant) =>
      variant ? this.variantTileImageUrl(card, variant) : this.thumbnailUrl(card),
    quantity: (card, variant) =>
      variant ? this.variantTileOwnedQuantity(card, variant) : this.quantityOwned(card),
    reverse: (card) => this.reverseQuantity(card),
    incoming: (card, variant) => this.incomingQuantity(card, variant?.variant_type ?? 'standard'),
    countIncoming: () => this.countIncoming.enabled(),
    open: (card, variant) => this.onCardClick(card, variant),
  };
  constructor(
    private readonly route: ActivatedRoute,
    private readonly catalogService: CatalogService,
    private readonly cardsService: CardsService,
    private readonly sharesService: SharesService,
    private readonly purchaseListsService: PurchaseListsService,
    private readonly saleListsService: SaleListsService,
    readonly countIncoming: CountIncomingService,
    readonly countDeckCards: CountDeckCardsService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
  ) {}
  ngOnInit(): void {
    this.setCode.set(this.route.snapshot.paramMap.get('setCode') ?? '');
    forkJoin({
      cards: this.catalogService.getSetCards(this.setCode()),
      owned: this.cardsService.list(this.setCode()),
      incoming: this.purchaseListsService.incoming(this.setCode()),
    }).subscribe(({ cards, owned, incoming }) => {
      this.cards.set(cards);
      if (lacksDefaultRarities(cards.map((card) => card.rarity))) {
        this.selectedRarities.set(new Set());
        this.selectedVariants.set([]);
        this.variantDisplayMode.set(printSelectionMode([]));
      }
      this.setName.set(cards[0]?.set_name ?? this.setCode());
      this.ownedCards.set(new Map(owned.map((card) => [card.catalog_id, card])));
      const byCard = new Map<number, Map<VariantType, number>>();
      for (const line of incoming) {
        const prints = byCard.get(line.catalog_id) ?? new Map<VariantType, number>();
        prints.set(line.variant_type, line.quantity);
        byCard.set(line.catalog_id, prints);
      }
      this.incoming.set(byCard);
      this.loading.set(false);
      this.recomputeFilteredCards();
    });
    this.catalogService.listSets().subscribe((sets) => {
      this.setInfo.set(sets.find((s) => s.set_code === this.setCode()) ?? null);
    });
    this.filterChangeSubscription = this.filterChange$.pipe(debounceTime(200)).subscribe(() => {
      this.recomputeFilteredCards();
    });
  }
  ngOnDestroy(): void {
    this.filterChangeSubscription?.unsubscribe();
  }
  onSearchChange(value: string): void {
    this.search.set(value);
    this.filterChange$.next();
  }
  /** Standard-grid ownership checks the exact Standard print, matching
   * the main Sets completion filter and the quantity controls. */
  quantityOwned(entry: CardCatalogEntry): number {
    const card = this.ownedCards().get(entry.id);
    if (!card) {
      return 0;
    }
    const allocated = !this.countDeckCards.enabled() ? this.allocatedVariantQuantity(card, 'standard') : 0;
    return Math.max(0, this.variantQuantity(card, 'standard') - allocated);
  }
  toggleCountDeckCards(): void {
    this.countDeckCards.toggle();
    this.recomputeFilteredCards();
  }
  cycleMinOwned(): void {
    this.minOwned.set(nextMinOwned(this.minOwned()));
    if (this.minOwned() > 0) {
      this.missingOnly.set(false);
    }
    this.recomputeFilteredCards();
  }
  /** Copies of one print on incoming purchase lists. */
  incomingQuantity(entry: CardCatalogEntry, variantType: VariantType): number {
    return this.incoming().get(entry.id)?.get(variantType) ?? 0;
  }
  toggleCountIncoming(): void {
    this.countIncoming.toggle();
    this.recomputeFilteredCards();
  }
  toggleMissingOnly(): void {
    this.missingOnly.set(!this.missingOnly());
    if (this.missingOnly()) {
      this.minOwned.set(0);
    }
    this.recomputeFilteredCards();
  }
  setOrder(order: CardOrder): void {
    this.order.set(order);
    storeCardOrder(ORDER_STORAGE_KEY, order);
    this.recomputeFilteredCards();
  }
  setView(view: SetView): void {
    this.view.set(view);
    this.recomputeFilteredCards();
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // Storage unavailable -- the choice just won't persist.
    }
  }
  /** True when every print variant is on screen (grouped 'both' grid or the
   * checklist), so the header counts variant prints instead of cards. */
  private get countsVariants(): boolean {
    return this.view() === 'checklist' || this.variantDisplayMode() !== 'standard';
  }
  /** "012/191"-style label: zero-padded to the set total's width, like the
   * printed card. Non-numeric numbers (promos) are shown as-is. */
  cardNumberLabel(entry: CardCatalogEntry): string {
    if (!/^\d+$/.test(entry.card_number) || !entry.card_count) {
      return entry.card_number;
    }
    const total = String(entry.card_count);
    return `${entry.card_number.padStart(total.length, '0')}/${total}`;
  }
  /** Numbered past the set's official count -- secret/ultra rares, same
   * "normal numbering" gate as data-model.md's completion_percent. */
  isSecretNumber(entry: CardCatalogEntry): boolean {
    return (
      /^\d+$/.test(entry.card_number) &&
      !!entry.card_count &&
      Number(entry.card_number) > entry.card_count
    );
  }
  /** One entry per (card, variant) pair among filteredCards' own
   * card_catalog_variants -- the unit the header counts whenever every
   * variant is on screen (see countsVariants). */
  private get variantTiles(): {
    entry: CardCatalogEntry;
    variant: CardCatalogVariant;
  }[] {
    return buildVariantTiles(this.filteredCards(), (entry) => this.displayedVariants(entry));
  }
  /** Header card count: unique cards in the standard grid, variant prints
   * in the grouped 'both' grid and the checklist -- see features.md's
   * "Show variants toggle". */
  get displayedCount(): number {
    return this.countsVariants ? this.variantTiles.length : this.filteredCards().length;
  }
  get displayedCompletionPercent(): number {
    if (!this.countsVariants) {
      return this.filteredCompletionPercent;
    }
    const tiles = this.variantTiles;
    const owned = tiles.filter((t) => this.variantTileCountsAsOwned(t.entry, t.variant)).length;
    return completionPercent(owned, tiles.length);
  }
  variantTileCountsAsOwned(entry: CardCatalogEntry, variant: CardCatalogVariant): boolean {
    return this.countsAsOwned(
      entry,
      variant.variant_type,
      this.variantTileOwnedQuantity(entry, variant),
    );
  }
  /** Owned copies, plus incoming ones while "Count incoming as owned" is on. */
  private countsAsOwned(entry: CardCatalogEntry, variantType: VariantType, owned: number): boolean {
    return (
      owned > 0 || (this.countIncoming.enabled() && this.incomingQuantity(entry, variantType) > 0)
    );
  }
  /** 'standard' reuses the catalog's own image_path (that's the print it
   * comes from, no separate pokecardex scan needed). Every other variant --
   * including 'reverse', which does have its own genuinely distinct
   * pokecardex scan despite being scraped the same way as 'standard' used
   * to be assumed -- uses its own image_path_fr/us (preferring the
   * account's language same as card_name.service's currentLang check,
   * falling back to whichever language actually resolved), falling back to
   * the catalog image only if that variant hasn't been scraped yet. */
  variantTileImageUrl(entry: CardCatalogEntry, variant: CardCatalogVariant): string {
    if (variant.variant_type === 'standard') {
      return this.imageUrl(entry);
    }
    const preferred =
      this.translate.currentLang() === 'fr' ? variant.image_path_fr : variant.image_path_us;
    const path = preferred ?? variant.image_path_fr ?? variant.image_path_us;
    return path ? this.catalogService.variantImageUrl(path) : this.imageUrl(entry);
  }
  displayedVariants(entry: CardCatalogEntry): CardCatalogVariant[] {
    return selectDisplayedPrints(
      entry.variants,
      this.selectedVariants(),
      this.minOwned(),
      (variant) => this.variantTileOwnedQuantity(entry, variant),
    ).filter((variant) => {
      if (!this.missingOnly()) {
        return true;
      }
      const shown = this.countsVariants ? variant.variant_type : 'standard';
      const owned = this.countsVariants
        ? this.variantTileOwnedQuantity(entry, variant)
        : this.quantityOwned(entry);
      return !this.countsAsOwned(entry, shown, owned);
    });
  }
  variantTileOwnedQuantity(entry: CardCatalogEntry, variant: CardCatalogVariant): number {
    const card = this.ownedCards().get(entry.id);
    if (!card) {
      return 0;
    }
    const allocated = !this.countDeckCards.enabled()
      ? this.allocatedVariantQuantity(card, variant.variant_type)
      : 0;
    return Math.max(0, this.variantQuantity(card, variant.variant_type) - allocated);
  }
  /** Adjusts this specific variant's owned quantity, mirroring stepQuantity
   * but generalized to any variant_type -- used by the grouped per-variant
   * tiles in 'both' mode and the checklist's steppers, the only places
   * reverse/ball-pattern quantities are editable (the standard-mode grid
   * only steps the standard print). */
  stepVariantQuantity(
    entry: CardCatalogEntry,
    variant: CardCatalogVariant,
    delta: number,
    event: Event,
  ): void {
    event.stopPropagation();
    if (this.pendingIds().has(entry.id)) {
      return;
    }
    const existing = this.ownedCards().get(entry.id);
    if (!existing) {
      if (delta <= 0) {
        return;
      }
      this.pendingIds.update((value) => {
        const next = new Set(value);
        next.add(entry.id);
        return next;
      });
      this.cardsService
        .add({ catalog_id: entry.id, variant_type: variant.variant_type, quantity: 1 })
        .subscribe({
          next: (card) => {
            this.pendingIds.update((value) => {
              const next = new Set(value);
              next.delete(entry.id);
              return next;
            });
            this.ownedCards.update((value) => {
              const next = new Map(value);
              next.set(entry.id, card);
              return next;
            });
            this.recomputeFilteredCards(true);
            this.toastService.show(this.translate.instant('sets.addedCard', { name: card.name }));
          },
          error: (err) => {
            this.pendingIds.update((value) => {
              const next = new Set(value);
              next.delete(entry.id);
              return next;
            });
            this.toastService.show(
              err?.error?.detail ?? this.translate.instant('sets.addCardFailed'),
              'error',
            );
          },
        });
      return;
    }
    const next = this.variantQuantity(existing, variant.variant_type) + delta;
    if (next < 0) {
      return;
    }
    this.pendingIds.update((value) => {
      const next = new Set(value);
      next.add(entry.id);
      return next;
    });
    this.cardsService
      .update(existing.id, {
        variant_type: variant.variant_type,
        quantity: next,
      })
      .subscribe({
        next: (updated) => {
          this.pendingIds.update((value) => {
            const next = new Set(value);
            next.delete(entry.id);
            return next;
          });
          if (!updated) {
            this.ownedCards.update((value) => {
              const next = new Map(value);
              next.delete(entry.id);
              return next;
            });
            this.recomputeFilteredCards(true);
            return;
          }
          this.ownedCards.update((value) => {
            const next = new Map(value);
            next.set(entry.id, updated);
            return next;
          });
          this.recomputeFilteredCards(true);
        },
        error: (err) => {
          this.pendingIds.update((value) => {
            const next = new Set(value);
            next.delete(entry.id);
            return next;
          });
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('sets.updateQuantityFailed'),
            'error',
          );
        },
      });
  }
  isPending(entry: CardCatalogEntry): boolean {
    return this.pendingIds().has(entry.id);
  }
  /** Displayed quantity across non-Standard prints, matching grouped tiles. */
  reverseQuantity(entry: CardCatalogEntry): number {
    const card = this.ownedCards().get(entry.id);
    if (!card) {
      return 0;
    }
    return card.variants
      .filter((v) => v.variant_type !== 'standard')
      .reduce(
        (sum, v) =>
          sum +
          Math.max(
            0,
            v.quantity -
              (!this.countDeckCards.enabled() ? this.allocatedVariantQuantity(card, v.variant_type) : 0),
          ),
        0,
      );
  }
  private allocatedVariantQuantity(card: Card, variantType: VariantType): number {
    return card.allocated_variants?.[variantType] ?? 0;
  }
  private variantQuantity(card: Card, variantType: VariantType): number {
    return card.variants.find((v) => v.variant_type === variantType)?.quantity ?? 0;
  }
  /** Distinct rarity *categories* present in this set (see
   * rarity-category.util.ts -- several raw rarity strings collapse onto the
   * same category, e.g. "Rare Holo ex"/"LEGEND" both show as "Ultra Rare"),
   * ordered common -> rare -- scoped to the set rather than the full
   * catalog's ~40 raw rarities, so the filter row only ever shows buttons
   * that can actually narrow this grid, one per distinct icon/button shown. */
  get availableRarities(): string[] {
    const seen = new Set<string>();
    for (const card of this.cards()) {
      if (card.rarity) {
        seen.add(rarityCategory(card.rarity));
      }
    }
    return sortRarityCategories(seen);
  }
  /** Owned copies across every print, the quantity sort's key. */
  private totalOwned(entry: CardCatalogEntry): number {
    return entry.variants.reduce(
      (sum, variant) => sum + this.variantTileOwnedQuantity(entry, variant),
      0,
    );
  }
  /** `keepOrder` (after a + or −) keeps the cards where they are, so a
   * quantity sort doesn't move the card being stepped. */
  private recomputeFilteredCards(keepOrder = false): void {
    const { term: numberTerm } = parseAnchoredSearch(this.search().trim().toLowerCase());
    const position = new Map(this.filteredCards().map((card, index) => [card.id, index]));
    const ordered = orderCards(this.cards(), this.order(), {
      name: (card) => card.name,
      quantity: (card) => this.totalOwned(card),
    });
    const filtered = ordered.filter((card) => {
      if (this.displayedVariants(card).length === 0) {
        return false;
      }
      const category = card.rarity ? rarityCategory(card.rarity) : null;
      if (
        this.selectedRarities().size > 0 &&
        (!category || !this.selectedRarities().has(category))
      ) {
        return false;
      }
      if (!this.search().trim()) {
        return true;
      }
      const matchesNumber = !!numberTerm && card.card_number.toLowerCase().includes(numberTerm);
      return matchesNumber || matchesCatalogSearch(card.name, this.search());
    });
    if (keepOrder) {
      // Cards that just appeared (e.g. missing again) go after the others.
      const rank = (card: CardCatalogEntry) => position.get(card.id) ?? position.size;
      filtered.sort((a, b) => rank(a) - rank(b));
    }
    this.filteredCards.set(filtered);
  }
  /** Completion over filteredCards (not the full set) so the header bar
   * updates live as the rarity/search filters narrow the grid. */
  get filteredCompletionPercent(): number {
    const filtered = this.filteredCards();
    if (filtered.length === 0) {
      return 0;
    }
    const owned = filtered.filter((card) =>
      this.countsAsOwned(card, 'standard', this.quantityOwned(card)),
    ).length;
    return Math.round((owned / filtered.length) * 100);
  }
  rarityIcon(rarity: string): string {
    return rarityIconUrl(rarity);
  }
  /** No icon dropped in for this rarity yet (frontend/public/rarity-icons is
   * filled in incrementally) -- hide the broken image and fall back to the
   * text badge sitting right behind it in the template. */
  onRarityIconError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    img.nextElementSibling?.classList.add('visible');
  }
  /** Adjusts (or creates/deletes) the collection row for this catalog card
   * directly from the set's card grid -- stops propagation so it doesn't
   * also trigger openDetail() on the tile underneath. */
  stepQuantity(entry: CardCatalogEntry, delta: number, event: Event): void {
    event.stopPropagation();
    if (this.pendingIds().has(entry.id)) {
      return;
    }
    const existing = this.ownedCards().get(entry.id);
    if (!existing) {
      if (delta <= 0) {
        return;
      }
      this.pendingIds.update((value) => {
        const next = new Set(value);
        next.add(entry.id);
        return next;
      });
      this.cardsService.add({ catalog_id: entry.id, quantity: 1 }).subscribe({
        next: (card) => {
          this.pendingIds.update((value) => {
            const next = new Set(value);
            next.delete(entry.id);
            return next;
          });
          this.ownedCards.update((value) => {
            const next = new Map(value);
            next.set(entry.id, card);
            return next;
          });
          this.recomputeFilteredCards(true);
          this.toastService.show(this.translate.instant('sets.addedCard', { name: card.name }));
        },
        error: (err) => {
          this.pendingIds.update((value) => {
            const next = new Set(value);
            next.delete(entry.id);
            return next;
          });
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('sets.addCardFailed'),
            'error',
          );
        },
      });
      return;
    }
    const next = this.variantQuantity(existing, 'standard') + delta;
    if (next < 0) {
      this.pendingIds.update((value) => {
        const next = new Set(value);
        next.delete(entry.id);
        return next;
      });
      return;
    }
    this.pendingIds.update((value) => {
      const next = new Set(value);
      next.add(entry.id);
      return next;
    });
    this.cardsService
      .update(existing.id, {
        variant_type: 'standard',
        quantity: next,
      })
      .subscribe({
        next: (updated) => {
          this.pendingIds.update((value) => {
            const next = new Set(value);
            next.delete(entry.id);
            return next;
          });
          if (!updated) {
            this.ownedCards.update((value) => {
              const next = new Map(value);
              next.delete(entry.id);
              return next;
            });
            this.recomputeFilteredCards(true);
            this.toastService.show(
              this.translate.instant('sets.removedCard', { name: existing.name }),
            );
            return;
          }
          this.ownedCards.update((value) => {
            const next = new Map(value);
            next.set(entry.id, updated);
            return next;
          });
          this.recomputeFilteredCards(true);
        },
        error: (err) => {
          this.pendingIds.update((value) => {
            const next = new Set(value);
            next.delete(entry.id);
            return next;
          });
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('sets.updateQuantityFailed'),
            'error',
          );
        },
      });
  }
  /** In sale mode a click on a card's scan puts one copy of that print in
   * the tray; the checklist's names and the group headers still open the
   * details. Otherwise every click opens them. */
  private onCardClick(entry: CardCatalogEntry, variant?: CardCatalogVariant): void {
    const onScan = this.view() !== 'checklist' && (!!variant || this.variantDisplayMode() === 'standard');
    if (!this.saleMode() || !onScan) {
      this.openDetail(entry, variant);
      return;
    }
    const print = variant?.variant_type ?? 'standard';
    if (this.trayQuantity(entry, print) >= this.sellable(entry, print)) {
      this.toastService.show(this.translate.instant('sets.sale.noneSellable'), 'error');
      return;
    }
    this.stepSale(entry, print, 1);
  }
  toggleSaleMode(): void {
    if (!this.saleMode()) {
      this.saleMode.set(true);
      this.loadSaleData();
      return;
    }
    if (this.saleTray().length > 0) {
      this.saleExitConfirmOpen.set(true);
      return;
    }
    this.exitSaleMode();
  }
  exitSaleMode(): void {
    this.saleExitConfirmOpen.set(false);
    this.saleTray.set([]);
    this.newSaleListName.set(null);
    this.salePanelExpanded.set(false);
    this.saleMode.set(false);
  }
  private loadSaleData(): void {
    forkJoin({
      lists: this.saleListsService.list(),
      onSale: this.saleListsService.onSale(),
    }).subscribe({
      next: ({ lists, onSale }) => {
        const open = lists.filter((list) => !list.sold_at);
        this.saleLists.set(open);
        const stored = readStoredSaleList();
        const current = this.saleListId();
        const keep = [current, stored].find((id) => open.some((list) => list.id === id));
        this.saleListId.set(keep ?? open[0]?.id ?? null);
        const byCard = new Map<number, Map<VariantType, number>>();
        for (const line of onSale) {
          const prints = byCard.get(line.catalog_id) ?? new Map<VariantType, number>();
          prints.set(line.variant_type, line.quantity);
          byCard.set(line.catalog_id, prints);
        }
        this.onSale.set(byCard);
      },
      error: () =>
        this.toastService.show(this.translate.instant('sets.sale.loadFailed'), 'error'),
    });
  }
  selectSaleList(value: string): void {
    if (value === 'new') {
      this.newSaleListName.set('');
      return;
    }
    const id = Number(value);
    this.saleListId.set(id);
    this.newSaleListName.set(null);
    try {
      localStorage.setItem(SALE_LIST_STORAGE_KEY, String(id));
    } catch {
      // Storage unavailable -- the choice just won't persist.
    }
  }
  cancelNewSaleList(): void {
    this.newSaleListName.set(null);
  }
  createSaleList(): void {
    const name = this.newSaleListName()?.trim();
    if (!name || this.saleBusy()) {
      return;
    }
    this.saleBusy.set(true);
    this.saleListsService.create(name).subscribe({
      next: (created) => {
        this.saleBusy.set(false);
        this.saleLists.update((lists) => [created, ...lists]);
        this.newSaleListName.set(null);
        this.selectSaleList(String(created.id));
      },
      error: (err) => {
        this.saleBusy.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('sets.sale.createFailed'),
          'error',
        );
      },
    });
  }
  /** Copies of a print that can still go on sale: owned − in normal decks −
   * on unsold sale lists (the tray not counted). */
  sellable(entry: CardCatalogEntry, variant: VariantType): number {
    const card = this.ownedCards().get(entry.id);
    if (!card) {
      return 0;
    }
    const onSale = this.onSale().get(entry.id)?.get(variant) ?? 0;
    return Math.max(
      0,
      this.variantQuantity(card, variant) - this.allocatedVariantQuantity(card, variant) - onSale,
    );
  }
  trayQuantity(entry: CardCatalogEntry, variant: VariantType): number {
    return (
      this.saleTray().find((line) => line.entry.id === entry.id && line.variant === variant)
        ?.quantity ?? 0
    );
  }
  /** One copy more or less of that print in the tray, within its sellable copies. */
  stepSale(entry: CardCatalogEntry, variant: VariantType, delta: number, event?: Event): void {
    event?.stopPropagation();
    const next = this.trayQuantity(entry, variant) + delta;
    if (next < 0 || next > this.sellable(entry, variant)) {
      return;
    }
    this.saleTray.update((tray) => {
      const others = tray.filter((line) => !(line.entry.id === entry.id && line.variant === variant));
      if (next === 0) {
        return others;
      }
      const index = tray.findIndex((line) => line.entry.id === entry.id && line.variant === variant);
      const line = { entry, variant, quantity: next };
      if (index < 0) {
        return [...tray, line];
      }
      const updated = [...tray];
      updated[index] = line;
      return updated;
    });
  }
  removeTrayLine(line: SaleTrayLine): void {
    this.saleTray.update((tray) => tray.filter((other) => other !== line));
  }
  /** Every shown print's sellable copies (outside decks and sale lists),
   * minus those already in the tray. What is shown follows the page's
   * filters (owned +0/+1/+2, rarity, print, search). The standard grid only
   * covers the standard print, like its tiles. */
  private extraCopies(): { catalog_id: number; variant_type: VariantType; quantity: number }[] {
    const items: { catalog_id: number; variant_type: VariantType; quantity: number }[] = [];
    for (const entry of this.filteredCards()) {
      const prints = this.countsVariants
        ? this.displayedVariants(entry).map((variant) => variant.variant_type)
        : (['standard'] as VariantType[]);
      for (const print of prints) {
        const quantity = this.sellable(entry, print) - this.trayQuantity(entry, print);
        if (quantity > 0) {
          items.push({ catalog_id: entry.id, variant_type: print, quantity });
        }
      }
    }
    return items;
  }
  openExtrasConfirm(): void {
    const items = this.extraCopies();
    if (items.length === 0) {
      this.toastService.show(this.translate.instant('sets.sale.noExtras'));
      return;
    }
    this.extrasConfirm.set(items);
  }
  extrasCopies(): number {
    return (this.extrasConfirm() ?? []).reduce((sum, item) => sum + item.quantity, 0);
  }
  saleListName(): string {
    return this.saleLists().find((list) => list.id === this.saleListId())?.name ?? '';
  }
  submitExtras(): void {
    const items = this.extrasConfirm();
    const listId = this.saleListId();
    if (!items || listId === null || this.saleBusy()) {
      return;
    }
    const count = this.extrasCopies();
    const name = this.saleListName();
    this.saleBusy.set(true);
    this.saleListsService.addCards(listId, items).subscribe({
      next: () => {
        this.saleBusy.set(false);
        this.extrasConfirm.set(null);
        this.addToOnSale(items);
        this.toastService.show(this.translate.instant('sets.sale.added', { count, name }));
      },
      error: (err) => {
        this.saleBusy.set(false);
        this.extrasConfirm.set(null);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('sets.sale.addFailed'),
          'error',
        );
      },
    });
  }
  private addToOnSale(
    items: { catalog_id: number; variant_type: VariantType; quantity: number }[],
  ): void {
    this.onSale.update((value) => {
      const next = new Map(value);
      for (const item of items) {
        const prints = new Map(next.get(item.catalog_id) ?? []);
        prints.set(item.variant_type, (prints.get(item.variant_type) ?? 0) + item.quantity);
        next.set(item.catalog_id, prints);
      }
      return next;
    });
  }
  submitSale(): void {
    const listId = this.saleListId();
    const tray = this.saleTray();
    if (listId === null || tray.length === 0 || this.saleBusy()) {
      return;
    }
    const count = this.saleTrayCopies();
    const listName = this.saleListName();
    this.saleBusy.set(true);
    this.saleListsService
      .addCards(
        listId,
        tray.map((line) => ({
          catalog_id: line.entry.id,
          variant_type: line.variant,
          quantity: line.quantity,
        })),
      )
      .subscribe({
        next: () => {
          this.saleBusy.set(false);
          this.addToOnSale(
            tray.map((line) => ({
              catalog_id: line.entry.id,
              variant_type: line.variant,
              quantity: line.quantity,
            })),
          );
          this.saleTray.set([]);
          this.toastService.show(
            this.translate.instant('sets.sale.added', { count, name: listName }),
          );
        },
        error: (err) => {
          this.saleBusy.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('sets.sale.addFailed'),
            'error',
          );
        },
      });
  }
  thumbnailUrl(entry: CardCatalogEntry): string {
    return this.catalogService.thumbnailUrl(entry.image_path);
  }
  imageUrl(entry: CardCatalogEntry): string {
    return this.catalogService.imageUrl(entry.image_path);
  }
  detailImageUrl(): string {
    if (!this.detailCard()) {
      return '';
    }
    return this.detailVariant()!
      ? this.variantTileImageUrl(this.detailCard()!, this.detailVariant()!)
      : this.imageUrl(this.detailCard()!);
  }
  /** French logo first (if the UI is in French), then the English logo,
   * then the symbol -- same fallback chain as the Sets list page. */
  private get logoCandidates(): string[] {
    if (!this.setInfo()) {
      return [];
    }
    const logos =
      this.translate.currentLang() === 'fr'
        ? [this.setInfo()!.logo_path_fr, this.setInfo()!.logo_path]
        : [this.setInfo()!.logo_path];
    return [...logos, this.setInfo()!.symbol_path]
      .filter((path): path is string => !!path)
      .map((path) => this.catalogService.imageUrl(path));
  }
  logoUrl(): string {
    return this.logoCandidates[0] ?? '';
  }
  onLogoError(event: Event): void {
    const candidates = this.logoCandidates;
    const img = event.target as HTMLImageElement;
    const next = Number(img.dataset['fallbackIdx'] ?? '0') + 1;
    if (next < candidates.length) {
      img.dataset['fallbackIdx'] = String(next);
      img.src = candidates[next];
    } else {
      img.style.visibility = 'hidden';
    }
  }
  openExportModal(): void {
    this.exportModalOpen.set(true);
  }
  closeExportModal(): void {
    this.exportModalOpen.set(false);
  }
  detailVariant = signal<CardCatalogVariant | null>(null);
  /** In 'both' mode the clicked tile passes its own variant explicitly; in
   * 'standard' mode there's no tile-level variant, so fall back to whichever
   * non-'standard' variant the user actually owns (if any) -- e.g. a card
   * owned only as Reverse should open showing the reverse scan, not the
   * standard one, even though its tile is the plain standard tile. */
  openDetail(entry: CardCatalogEntry, variant?: CardCatalogVariant): void {
    this.detailCard.set(entry);
    this.detailVariant.set(variant ?? this.ownedNonStandardVariant(entry));
  }
  private ownedNonStandardVariant(entry: CardCatalogEntry): CardCatalogVariant | null {
    const card = this.ownedCards().get(entry.id);
    if (!card || this.variantQuantity(card, 'standard') > 0) {
      return null;
    }
    return (
      entry.variants.find(
        (v) => v.variant_type !== 'standard' && this.variantQuantity(card, v.variant_type) > 0,
      ) ?? null
    );
  }
  closeDetail(): void {
    this.detailCard.set(null);
    this.detailVariant.set(null);
  }
  openShareModal(): void {
    this.createdShare.set(null);
    this.shareDurationDays.set(7);
    this.shareModalOpen.set(true);
  }
  closeShareModal(): void {
    this.shareModalOpen.set(false);
  }
  /** See documentation/features.md's "Share a set" -- generates a public,
   * read-only link to this set for the chosen duration. Doesn't auto-close
   * the modal so there's time to copy the resulting link. */
  createShare(): void {
    this.creatingShare.set(true);
    this.sharesService
      .create({ set_code: this.setCode(), duration_days: this.shareDurationDays() })
      .subscribe({
        next: (share) => {
          this.creatingShare.set(false);
          this.createdShare.set(share);
        },
        error: () => {
          this.creatingShare.set(false);
          this.toastService.show(this.translate.instant('sets.shareCreateFailed'), 'error');
        },
      });
  }
  shareUrl(share: Share): string {
    return this.sharesService.shareUrl(share.token);
  }
  copyShareLink(share: Share): void {
    navigator.clipboard.writeText(this.shareUrl(share)).then(
      () => this.toastService.show(this.translate.instant('sets.shareLinkCopied')),
      () => this.toastService.show(this.translate.instant('sets.shareCopyFailed'), 'error'),
    );
  }
}
