import { Icon } from '@shared';
import { signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  ElementRef,
  Inject,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { Card, CardVariant, SetOption, VARIANT_LABELS, VariantType } from '../../models/card.model';
import { CardNameService } from '../../services/card-name.service';
import { CardsService } from '../../services/cards.service';
import { CatalogService } from '../../services/catalog.service';
import { DeckListService } from '../../services/deck-list.service';
import { ToastService } from '../../services/toast.service';
import { CardDisplayNamePipe } from '../../util/card-display-name.pipe';
import {
  loadStoredFilters,
  normalizeMultiFilter,
  saveStoredFilters,
} from '../../util/filter-storage.util';
import { rarityCategories, rawRaritiesForCategory } from '../../util/rarity-category.util';
import { SORT_OPTIONS, SortOption } from '../../util/sort.util';
import { buildVariantTiles, VariantDisplayMode } from '../../util/variant-display.util';
import { DeckListPanelComponent } from '../deck/deck-list-panel/deck-list-panel.component';
import { CardDetailComponent } from '../shared/card-detail/card-detail.component';
import { FiltersPanelComponent } from '../shared/filters-panel/filters-panel.component';
import { ModalComponent } from '../shared/modal/modal.component';
import { VariantModeToggleComponent } from '../shared/variant-mode-toggle/variant-mode-toggle.component';
type CollectionView = 'grid' | 'table';
interface CollectionFilters {
  search: string;
  setCode: string;
  setFilter: string;
  supertype: string[];
  rarity: string[];
  available: '' | 'available' | 'unavailable';
  cardNumber: string;
  variantType: VariantType[];
  sort: SortOption;
}
const FILTERS_STORAGE_KEY = 'pokemon-cards:collection-filters';
@Component({
  selector: 'app-collection',
  imports: [
    Icon,
    FormsModule,
    TranslatePipe,
    ModalComponent,
    DeckListPanelComponent,
    FiltersPanelComponent,
    CardDetailComponent,
    CardDisplayNamePipe,
    VariantModeToggleComponent,
  ],
  templateUrl: './collection.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './collection.component.scss',
})
export class CollectionComponent implements OnInit, OnDestroy {
  @ViewChild('scrollSentinel')
  set scrollSentinel(el: ElementRef<HTMLElement> | undefined) {
    this.observer?.disconnect();
    if (el) {
      this.observer ??= new IntersectionObserver((entries) => {
        if (entries[0]?.isIntersecting) {
          this.loadMore();
        }
      });
      this.observer.observe(el.nativeElement);
    }
  }
  /** Cards loaded so far (accumulates across infinite-scroll pages) --
   * already filtered/sorted server-side, unlike the old client-side
   * filteredCards derived from a fully-loaded `cards` array. */
  cards = signal<Card[]>([]);
  total = signal(0);
  totalQuantity = signal(0);
  page = signal(1);
  pageSize = signal(50);
  loading = signal(false);
  loadingMore = signal(false);
  view = signal<CollectionView>('grid');
  search = signal('');
  setCode = signal('');
  setFilter = signal('');
  supertype = signal<string[]>([]);
  rarity = signal<string[]>([]);
  available = signal<'' | 'available' | 'unavailable'>('');
  cardNumber = signal('');
  variantType = signal<VariantType[]>([]);
  sort = signal<SortOption>('name_asc');
  readonly sortOptions = SORT_OPTIONS;
  filtersOpen = signal(false);
  /** Filter dropdown options -- computed server-side over the whole
   * collection regardless of the currently active filters (GET
   * /api/cards/filter-options), same scope the old client-side getters
   * (`sets`/`rarities`/`ownedVariantTypes`) had over the fully-loaded
   * `cards` array. */
  sets = signal<SetOption[]>([]);
  rarities = signal<string[]>([]);
  ownedVariantTypes = signal<VariantType[]>([]);
  /** Toggles standard <-> both on each click of the "show variants" button --
   * same convention as set-detail.component.ts/browse.component.ts. 'both'
   * explodes each card into one tile per *owned* variant (card.variants only
   * ever holds owned rows, unlike Browse/Set Detail which explode over every
   * variant that exists in the catalog whether owned or not). */
  variantDisplayMode = signal<VariantDisplayMode>('standard');
  private observer?: IntersectionObserver;
  private latestRequestId = 0;
  private readonly isBrowser: boolean;
  private readonly filterChange$ = new Subject<void>();
  private filterChangeSubscription?: Subscription;
  constructor(
    private readonly cardsService: CardsService,
    private readonly catalogService: CatalogService,
    private readonly toastService: ToastService,
    private readonly deckListService: DeckListService,
    private readonly translate: TranslateService,
    private readonly cardNameService: CardNameService,
    @Inject(PLATFORM_ID)
    platformId: object,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }
  ngOnInit(): void {
    this.restoreFilters();
    this.loadFilterOptions();
    this.loadPage(1);
    this.filterChangeSubscription = this.filterChange$.pipe(debounceTime(200)).subscribe(() => {
      this.loadPage(1);
    });
  }
  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.filterChangeSubscription?.unsubscribe();
  }
  onFilterChange(): void {
    this.persistFilters();
    this.filterChange$.next();
  }
  private restoreFilters(): void {
    const saved = loadStoredFilters<CollectionFilters>(this.isBrowser, FILTERS_STORAGE_KEY);
    if (!saved) {
      return;
    }
    this.search.set(saved.search ?? '');
    this.setCode.set(saved.setCode ?? '');
    this.setFilter.set(saved.setFilter ?? '');
    this.supertype.set(normalizeMultiFilter(saved.supertype));
    this.rarity.set(normalizeMultiFilter(saved.rarity));
    this.available.set(saved.available ?? '');
    this.cardNumber.set(saved.cardNumber ?? '');
    this.variantType.set(normalizeMultiFilter(saved.variantType) as VariantType[]);
    this.sort.set(saved.sort ?? 'name_asc');
  }
  private persistFilters(): void {
    const filters: CollectionFilters = {
      search: this.search(),
      setCode: this.setCode(),
      setFilter: this.setFilter(),
      supertype: this.supertype(),
      rarity: this.rarity(),
      available: this.available(),
      cardNumber: this.cardNumber(),
      variantType: this.variantType(),
      sort: this.sort(),
    };
    saveStoredFilters(this.isBrowser, FILTERS_STORAGE_KEY, filters);
  }
  private loadFilterOptions(): void {
    this.cardsService.filterOptions().subscribe((options) => {
      this.sets.set(options.sets);
      this.rarities.set(rarityCategories(options.rarities));
      this.ownedVariantTypes.set(options.owned_variant_types);
    });
  }
  get hasMore(): boolean {
    return this.cards().length < this.total();
  }
  loadMore(): void {
    if (this.loading() || this.loadingMore() || !this.hasMore) {
      return;
    }
    this.loadPage(this.page() + 1, true);
  }
  /** Reloads from page 1, discarding any pages accumulated via infinite
   * scroll -- used for filter changes and after a mutation (add/edit/delete
   * a card, add to deck) since those can shift which page a card belongs on. */
  loadPage(page: number, append = false): void {
    if (append) {
      this.loadingMore.set(true);
    } else {
      this.loading.set(true);
    }
    // Filter changes, initial load, and infinite-scroll "load more" can all
    // have requests in flight at once; only the response matching the
    // latest request actually gets applied (same guard as browse.component).
    const requestId = ++this.latestRequestId;
    this.cardsService
      .search({
        search: this.search() || undefined,
        setCode: this.setCode() || undefined,
        setName: (!this.setCode() && this.setFilter()) || undefined,
        supertype: this.supertype().length ? this.supertype() : undefined,
        rarity: this.rarity().length ? this.rarity().flatMap(rawRaritiesForCategory) : undefined,
        available: this.available() || undefined,
        cardNumber: this.cardNumber() || undefined,
        variantType: this.variantType().length ? this.variantType() : undefined,
        sort: this.sort(),
        page,
        pageSize: this.pageSize(),
      })
      .subscribe({
        next: (result) => {
          if (requestId !== this.latestRequestId) {
            return;
          }
          this.cards.set(append ? [...this.cards(), ...result.items] : result.items);
          this.total.set(result.total);
          this.totalQuantity.set(result.total_quantity);
          this.page.set(result.page);
          this.loading.set(false);
          this.loadingMore.set(false);
        },
        error: () => {
          if (requestId !== this.latestRequestId) {
            return;
          }
          this.loading.set(false);
          this.loadingMore.set(false);
        },
      });
  }
  /** Reloads the current filtered view from page 1 -- bound to the deck-list
   * panel's `(added)` event and other mutations, matching the old load()'s
   * role of refreshing after a change elsewhere. */
  load(): void {
    this.loadPage(1);
  }
  setView(view: CollectionView): void {
    this.view.set(view);
  }
  get hasActiveFilters(): boolean {
    return (
      !!this.search() ||
      !!this.setCode() ||
      !!this.setFilter() ||
      this.supertype().length > 0 ||
      this.rarity().length > 0 ||
      !!this.available() ||
      !!this.cardNumber() ||
      this.variantType().length > 0 ||
      this.sort() !== 'name_asc'
    );
  }
  /** True only when the whole collection is empty (no filters active and no
   * results) -- distinct from "filters matched nothing", which shows a
   * different message. See collection.component.html. */
  get isCollectionEmpty(): boolean {
    return !this.hasActiveFilters && this.total() === 0 && !this.loading();
  }
  clearFilters(): void {
    this.search.set('');
    this.setCode.set('');
    this.setFilter.set('');
    this.supertype.set([]);
    this.rarity.set([]);
    this.available.set('');
    this.cardNumber.set('');
    this.variantType.set([]);
    this.sort.set('name_asc');
    this.persistFilters();
    this.loadPage(1);
  }
  toggleFilters(): void {
    this.filtersOpen.set(!this.filtersOpen());
  }
  closeFilters(): void {
    this.filtersOpen.set(false);
  }
  onVariantDisplayModeChange(mode: VariantDisplayMode): void {
    this.variantDisplayMode.set(mode);
  }
  get variantModeToggleLabel(): string {
    const key =
      this.variantDisplayMode() === 'standard'
        ? 'collection.showVariantsStandard'
        : 'collection.showVariantsBoth';
    return this.translate.instant(key);
  }
  /** One entry per (card, variant) pair among the loaded cards' own *owned*
   * variants -- what the grid renders in 'both' mode. card.variants only
   * ever holds rows actually owned (quantity > 0, see data-model.md's
   * card_variant_quantities), so unlike Browse/Set Detail this never
   * produces a tile for a variant that exists in the catalog but isn't
   * owned. Doesn't change which cards are loaded, only how each is broken
   * out. */
  get variantTiles(): {
    entry: Card;
    variant: CardVariant;
  }[] {
    if (this.variantDisplayMode() === 'standard') {
      return [];
    }
    return buildVariantTiles(this.cards(), (card) => card.variants);
  }
  variantTileLabel(variant: CardVariant): string {
    return VARIANT_LABELS[variant.variant_type];
  }
  /** 'standard' reuses the card's own thumbnail (also honoring the owned-
   * variant filter's image swap, same as thumbnailUrl()); every other
   * variant uses its own pokecardex scan carried on CardVariantOut (see
   * data-model.md's card_variant_quantities "API response only" note),
   * falling back to the card thumbnail if that variant hasn't been scraped
   * yet. */
  variantTileImageUrl(card: Card, variant: CardVariant): string {
    if (variant.variant_type === 'standard') {
      return this.thumbnailUrl(card);
    }
    const preferred =
      this.translate.currentLang() === 'fr' ? variant.image_path_fr : variant.image_path_us;
    const path = preferred ?? variant.image_path_fr ?? variant.image_path_us;
    return path ? this.catalogService.variantImageUrl(path) : this.thumbnailUrl(card);
  }
  /** When the Variante filter is active, swaps in the matched variant's own
   * scan instead of always the standard print -- see features.md's "Search &
   * filter the collection". Picks the first owned variant among
   * card.variants that satisfies the active filter; falls back to the
   * standard image_path if none matched or that variant has no scan yet. */
  private filterMatchedVariant(card: Card): CardVariant | null {
    if (!this.variantType().length) {
      return null;
    }
    return (
      card.variants.find((v) => this.variantType().includes(v.variant_type) && v.quantity > 0) ??
      null
    );
  }
  private filterMatchedVariantImagePath(card: Card): string | null {
    const matched = this.filterMatchedVariant(card);
    if (!matched) {
      return null;
    }
    const preferred =
      this.translate.currentLang() === 'fr' ? matched.image_path_fr : matched.image_path_us;
    return preferred ?? matched.image_path_fr ?? matched.image_path_us;
  }
  imageUrl(card: Card, variant?: CardVariant | null): string {
    if (variant && variant.variant_type !== 'standard') {
      const preferred =
        this.translate.currentLang() === 'fr' ? variant.image_path_fr : variant.image_path_us;
      const path = preferred ?? variant.image_path_fr ?? variant.image_path_us;
      if (path) {
        return this.catalogService.variantImageUrl(path);
      }
    }
    const path = this.filterMatchedVariantImagePath(card);
    return path
      ? this.catalogService.variantImageUrl(path)
      : this.catalogService.imageUrl(card.image_path);
  }
  /** Owned quantity across every non-'standard' variant (reverse + any
   * ball-pattern reverses) -- see data-model.md's "Quantity model". */
  reverseTotal(card: Card): number {
    return card.variants
      .filter((v) => v.variant_type !== 'standard')
      .reduce((sum, v) => sum + v.quantity, 0);
  }
  thumbnailUrl(card: Card): string {
    const path = this.filterMatchedVariantImagePath(card);
    return path
      ? this.catalogService.variantImageUrl(path)
      : this.catalogService.thumbnailUrl(card.image_path);
  }
  addToList(card: Card, variant?: CardVariant): void {
    this.deckListService.addCard(card, variant?.variant_type ?? 'standard');
  }
  detailCard = signal<Card | null>(null);
  detailVariant = signal<CardVariant | null>(null);
  openDetail(card: Card, variant?: CardVariant): void {
    this.detailCard.set(card);
    // A standard-mode tile has no explicit variant of its own, but its
    // image may still have been swapped to a filter-matched variant's scan
    // (see filterMatchedVariantImagePath above) -- carry that variant into
    // the modal too, so the picker's initial selection matches what's shown
    // instead of mislabeling that art as the standard print.
    this.detailVariant.set(variant ?? this.filterMatchedVariant(card));
  }
  closeDetail(): void {
    this.detailCard.set(null);
    this.detailVariant.set(null);
  }
  saveDetailQuantity(change: { variantType: VariantType; quantity: number }): void {
    if (!this.detailCard()) {
      return;
    }
    const card = this.detailCard()!;
    this.cardsService
      .update(card.id, {
        variant_type: change.variantType,
        quantity: change.quantity,
      })
      .subscribe({
        next: (updated) => {
          if (!updated) {
            // Last variant removed -- the whole card was deleted server-side.
            this.toastService.show(
              this.translate.instant('collection.removedCard', { name: card.name }),
            );
            this.closeDetail();
            this.load();
            return;
          }
          const index = this.cards().findIndex((c) => c.id === updated.id);
          if (index !== -1) {
            this.cards.update((value) => {
              const next = [...value];
              next[index] = updated;
              return next;
            });
          }
          this.detailCard.set(updated);
          this.toastService.show(
            this.translate.instant('collection.updatedQuantity', { name: updated.name }),
          );
        },
        error: (err) =>
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('collection.updateQuantityFailed'),
            'error',
          ),
      });
  }
  deleteDetailCard(): void {
    if (!this.detailCard()) {
      return;
    }
    const card = this.detailCard()!;
    this.cardsService.delete(card.id).subscribe({
      next: () => {
        this.closeDetail();
        this.toastService.show(
          this.translate.instant('collection.removedCard', { name: card.name }),
        );
        this.load();
      },
      error: (err) =>
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('collection.removeCardFailed'),
          'error',
        ),
    });
  }
}
