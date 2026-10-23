import { Icon } from '@shared';
import { signal } from '@angular/core';
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
import { CardsService } from '../../../services/cards.service';
import { CountIncomingService } from '../../../services/count-incoming.service';
import { PurchaseListsService } from '../../../services/purchase-lists.service';
import { CatalogService } from '../../../services/catalog.service';
import { SharesService } from '../../../services/shares.service';
import { ToastService } from '../../../services/toast.service';
import { CardDisplayNamePipe } from '../../../util/card-display-name.pipe';
import { matchesCatalogSearch, parseAnchoredSearch } from '../../../util/pokemon-translations.util';
import {
  rarityCategory,
  rawRaritiesForCategory,
  sortRarityCategories,
} from '../../../util/rarity-category.util';
import { rarityIconUrl } from '../../../util/rarity-icons.util';
import { DEFAULT_SET_RARITIES, DEFAULT_SET_VARIANTS } from '../../../util/set-filter-defaults.util';
import { variantIconUrl } from '../../../util/variant-icons.util';
import { CardDetailComponent } from '../../shared/card-detail/card-detail.component';
import { CardOrderComponent } from '../../shared/card-order/card-order.component';
import {
  CardOrder,
  orderCards,
  readStoredCardOrder,
  storeCardOrder,
} from '../../../util/card-order.util';
import { SetCardGridComponent, SetGridAdapter } from '../set-card-grid/set-card-grid.component';
import { ModalComponent } from '../../shared/modal/modal.component';
import {
  buildVariantTiles,
  completionPercent,
  VariantDisplayMode,
  printSelectionMode,
  selectDisplayedPrints,
} from '../../../util/variant-display.util';
const VIEW_STORAGE_KEY = 'setDetailView';
const ORDER_STORAGE_KEY = 'setDetailOrder';
function readStoredView(): 'grid' | 'checklist' | 'binder' {
  try {
    const view = localStorage.getItem(VIEW_STORAGE_KEY);
    return view === 'checklist' || view === 'binder' ? view : 'grid';
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
  exportingMissing = signal(false);
  exportSelectedRarities = signal(new Set<string>());
  exportFormat = signal<'tcgplayer' | 'cardmarket'>('cardmarket');
  exportLanguage = signal<'en' | 'fr'>('en');
  exportExcludeInDeck = signal(false);
  exportVariantType = signal<VariantType>('standard');
  readonly exportVariantLabels = VARIANT_LABELS;
  readonly exportVariantIcon = variantIconUrl;
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
  excludeInDeck = signal(false);
  missingOnly = signal(false);
  duplicatesOnly = signal(false);
  /** Selected print controls the grid layout. */
  variantDisplayMode = signal<VariantDisplayMode>(printSelectionMode(this.selectedVariants()));
  /** Grid, checklist, or nine-pocket binder. Remembered per browser. */
  view = signal<'grid' | 'checklist' | 'binder'>(readStoredView());
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
    open: (card, variant) => this.openDetail(card, variant),
  };
  constructor(
    private readonly route: ActivatedRoute,
    private readonly catalogService: CatalogService,
    private readonly cardsService: CardsService,
    private readonly sharesService: SharesService,
    private readonly purchaseListsService: PurchaseListsService,
    readonly countIncoming: CountIncomingService,
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
    const allocated = this.excludeInDeck() ? this.allocatedVariantQuantity(card, 'standard') : 0;
    return Math.max(0, this.variantQuantity(card, 'standard') - allocated);
  }
  toggleExcludeInDeck(): void {
    this.excludeInDeck.set(!this.excludeInDeck());
    this.recomputeFilteredCards();
  }
  toggleDuplicatesOnly(): void {
    this.duplicatesOnly.set(!this.duplicatesOnly());
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
    this.recomputeFilteredCards();
  }
  setOrder(order: CardOrder): void {
    this.order.set(order);
    storeCardOrder(ORDER_STORAGE_KEY, order);
    this.recomputeFilteredCards();
  }
  setView(view: 'grid' | 'checklist' | 'binder'): void {
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
    const owned = tiles.filter((t) => this.variantTileOwnedQuantity(t.entry, t.variant) > 0).length;
    return completionPercent(owned, tiles.length);
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
      this.duplicatesOnly(),
      (variant) => this.ownedVariantQuantity(entry, variant),
    ).filter((variant) => {
      if (!this.missingOnly()) {
        return true;
      }
      const shown = this.countsVariants ? variant.variant_type : 'standard';
      const owned = this.countsVariants
        ? this.variantTileOwnedQuantity(entry, variant)
        : this.quantityOwned(entry);
      const incoming = this.countIncoming.enabled() ? this.incomingQuantity(entry, shown) : 0;
      return owned + incoming <= 0;
    });
  }
  variantTileOwnedQuantity(entry: CardCatalogEntry, variant: CardCatalogVariant): number {
    const card = this.ownedCards().get(entry.id);
    if (!card) {
      return 0;
    }
    const allocated = this.excludeInDeck()
      ? this.allocatedVariantQuantity(card, variant.variant_type)
      : 0;
    return Math.max(0, this.variantQuantity(card, variant.variant_type) - allocated);
  }
  private ownedVariantQuantity(entry: CardCatalogEntry, variant: CardCatalogVariant): number {
    const card = this.ownedCards().get(entry.id);
    return card ? this.variantQuantity(card, variant.variant_type) : 0;
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
              (this.excludeInDeck() ? this.allocatedVariantQuantity(card, v.variant_type) : 0),
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
    const owned = filtered.filter((card) => this.quantityOwned(card) > 0).length;
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
  toggleExportRarity(rarity: string): void {
    if (this.exportSelectedRarities().has(rarity)) {
      this.exportSelectedRarities.update((value) => {
        const next = new Set(value);
        next.delete(rarity);
        return next;
      });
    } else {
      this.exportSelectedRarities.update((value) => {
        const next = new Set(value);
        next.add(rarity);
        return next;
      });
    }
  }
  isExportRarityActive(rarity: string): boolean {
    return this.exportSelectedRarities().has(rarity);
  }
  isAllExportRaritiesActive(): boolean {
    return this.exportSelectedRarities().size === 0;
  }
  clearExportRarities(): void {
    this.exportSelectedRarities.set(new Set());
  }
  toggleExportExcludeInDeck(): void {
    this.exportExcludeInDeck.set(!this.exportExcludeInDeck());
  }
  /** Copies a TCGplayer/PTCGL- or Cardmarket-format decklist (per
   * exportFormat) of every card in this set not owned at all to the
   * clipboard, narrowed to exportSelectedRarities (empty = every rarity,
   * including secret/extra-numbered cards -- no numbering gate hides them),
   * rendered in exportLanguage, and -- when exportExcludeInDeck is on --
   * also treating copies allocated to a deck as unavailable (same rule as
   * the page's own "don't count cards in a deck" toggle, but a separate,
   * independent flag, same pattern as exportSelectedRarities vs.
   * selectedRarities) -- mirrors the deck export panel's copy-to-clipboard
   * pattern. */
  exportMissing(): void {
    this.exportingMissing.set(true);
    const rawRarities = [...this.exportSelectedRarities()].flatMap((category) =>
      rawRaritiesForCategory(category),
    );
    this.catalogService
      .exportSetMissingText(
        this.setCode(),
        rawRarities,
        this.exportFormat(),
        this.exportLanguage(),
        this.exportExcludeInDeck(),
        this.countIncoming.enabled(),
        this.exportVariantType(),
      )
      .subscribe({
        next: (text) => {
          this.exportingMissing.set(false);
          if (!text) {
            this.toastService.show(this.translate.instant('sets.exportMissingEmpty'));
            return;
          }
          navigator.clipboard.writeText(text).then(
            () => {
              this.toastService.show(this.translate.instant('sets.exportMissingCopied'));
              this.exportModalOpen.set(false);
            },
            () =>
              this.toastService.show(
                this.translate.instant('sets.exportMissingCopyFailed'),
                'error',
              ),
          );
        },
        error: () => {
          this.exportingMissing.set(false);
          this.toastService.show(this.translate.instant('sets.exportMissingFailed'), 'error');
        },
      });
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
