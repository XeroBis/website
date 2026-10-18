import { AuthService } from '@shared';
import { inject } from '@angular/core';
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
import {
  CardCatalogEntry,
  CardCatalogVariant,
  CardSet,
  VariantType,
  VARIANT_LABELS,
} from '../../models/card.model';
import { CatalogService } from '../../services/catalog.service';
import { CollectionAddListService } from '../../services/collection-add-list.service';
import { ToastService } from '../../services/toast.service';
import { supertypeKey as supertypeKeyFor } from '../../util/card-type-translate.util';
import { CardDisplayNamePipe } from '../../util/card-display-name.pipe';
import {
  loadStoredFilters,
  normalizeMultiFilter,
  saveStoredFilters,
} from '../../util/filter-storage.util';
import { rarityCategories, rawRaritiesForCategory } from '../../util/rarity-category.util';
import { SORT_OPTIONS, SortOption } from '../../util/sort.util';
import { buildVariantTiles, VariantDisplayMode } from '../../util/variant-display.util';
import { CollectionAddPanelComponent } from '../collection/collection-add-panel/collection-add-panel.component';
import { CardDetailComponent } from '../shared/card-detail/card-detail.component';
import { FiltersPanelComponent } from '../shared/filters-panel/filters-panel.component';
import { ModalComponent } from '../shared/modal/modal.component';
import { VariantModeToggleComponent } from '../shared/variant-mode-toggle/variant-mode-toggle.component';
type BrowseView = 'grid' | 'table';
interface BrowseFilters {
  variantType: VariantType[];
  search: string;
  setCode: string;
  setFilter: string;
  supertype: string[];
  rarity: string[];
  cardNumber: string;
  sort: SortOption;
}
const FILTERS_STORAGE_KEY = 'pokemon-cards:browse-filters';
@Component({
  selector: 'app-browse',
  imports: [
    Icon,
    FormsModule,
    TranslatePipe,
    FiltersPanelComponent,
    CollectionAddPanelComponent,
    CardDetailComponent,
    ModalComponent,
    CardDisplayNamePipe,
    VariantModeToggleComponent,
  ],
  templateUrl: './browse.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './browse.component.scss',
})
export class BrowseComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
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
  items = signal<CardCatalogEntry[]>([]);
  view = signal<BrowseView>('grid');
  sets = signal<CardSet[]>([]);
  rarities = signal<string[]>([]);
  total = signal(0);
  page = signal(1);
  pageSize = signal(100);
  search = signal('');
  setCode = signal('');
  setFilter = signal('');
  supertype = signal<string[]>([]);
  rarity = signal<string[]>([]);
  variantType = signal<VariantType[]>([]);
  variantOptions = signal<VariantType[]>([]);
  cardNumber = signal('');
  /** Toggles standard <-> both on each click of the "show variants" button --
   * same convention as set-detail.component.ts. 'standard': one tile per
   * catalog card (its standard print). 'both': one tile per (card, variant)
   * pair among the loaded page's own card_catalog_variants. */
  variantDisplayMode = signal<VariantDisplayMode>('standard');
  sort = signal<SortOption>('name_asc');
  readonly sortOptions = SORT_OPTIONS;
  loading = signal(false);
  loadingMore = signal(false);
  filtersOpen = signal(false);
  private observer?: IntersectionObserver;
  private latestRequestId = 0;
  private readonly filterChange$ = new Subject<void>();
  private filterChangeSubscription?: Subscription;
  private readonly isBrowser: boolean;
  constructor(
    private readonly catalogService: CatalogService,
    private readonly toastService: ToastService,
    private readonly collectionAddListService: CollectionAddListService,
    private readonly translate: TranslateService,
    @Inject(PLATFORM_ID)
    platformId: object,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }
  ngOnInit(): void {
    this.restoreFilters();
    this.catalogService.listSets().subscribe((sets) => this.sets.set(sets));
    this.catalogService
      .listRarities()
      .subscribe((rarities) => this.rarities.set(rarityCategories(rarities)));
    this.catalogService.listVariantTypes().subscribe((types) => this.variantOptions.set(types));
    this.loadPage(1);
    this.filterChangeSubscription = this.filterChange$.pipe(debounceTime(300)).subscribe(() => {
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
    const saved = loadStoredFilters<BrowseFilters>(this.isBrowser, FILTERS_STORAGE_KEY);
    if (!saved) {
      return;
    }
    this.search.set(saved.search ?? '');
    this.setCode.set(saved.setCode ?? '');
    this.setFilter.set(saved.setFilter ?? '');
    this.supertype.set(normalizeMultiFilter(saved.supertype));
    this.rarity.set(normalizeMultiFilter(saved.rarity));
    this.variantType.set(normalizeMultiFilter(saved.variantType) as VariantType[]);
    this.cardNumber.set(saved.cardNumber ?? '');
    this.sort.set(saved.sort ?? 'name_asc');
  }
  private persistFilters(): void {
    const filters: BrowseFilters = {
      search: this.search(),
      setCode: this.setCode(),
      setFilter: this.setFilter(),
      supertype: this.supertype(),
      rarity: this.rarity(),
      variantType: this.variantType(),
      cardNumber: this.cardNumber(),
      sort: this.sort(),
    };
    saveStoredFilters(this.isBrowser, FILTERS_STORAGE_KEY, filters);
  }
  get hasMore(): boolean {
    return this.items().length < this.total();
  }
  loadMore(): void {
    if (this.loading() || this.loadingMore() || !this.hasMore) {
      return;
    }
    this.loadPage(this.page() + 1, true);
  }
  loadPage(page: number, append = false): void {
    if (append) {
      this.loadingMore.set(true);
    } else {
      this.loading.set(true);
    }
    // Filter changes, initial load, and infinite-scroll "load more" can all
    // have requests in flight at once; on slow/variable mobile connections an
    // older request can resolve after a newer one and clobber its results, so
    // only the response matching the latest request actually gets applied.
    const requestId = ++this.latestRequestId;
    this.catalogService
      .browse({
        search: this.search() || undefined,
        setCode: this.setCode() || undefined,
        setName: (!this.setCode() && this.setFilter()) || undefined,
        supertype: this.supertype().length ? this.supertype() : undefined,
        rarity: this.rarity().length ? this.rarity().flatMap(rawRaritiesForCategory) : undefined,
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
          this.items.set(append ? [...this.items(), ...result.items] : result.items);
          this.total.set(result.total);
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
  get hasActiveFilters(): boolean {
    return (
      !!this.search() ||
      !!this.setCode() ||
      !!this.setFilter() ||
      this.supertype().length > 0 ||
      this.rarity().length > 0 ||
      this.variantType().length > 0 ||
      !!this.cardNumber() ||
      this.sort() !== 'name_asc'
    );
  }
  clearFilters(): void {
    this.search.set('');
    this.setCode.set('');
    this.setFilter.set('');
    this.supertype.set([]);
    this.rarity.set([]);
    this.variantType.set([]);
    this.cardNumber.set('');
    this.sort.set('name_asc');
    this.persistFilters();
    this.loadPage(1);
  }
  onVariantDisplayModeChange(mode: VariantDisplayMode): void {
    this.variantDisplayMode.set(mode);
  }
  get variantModeToggleLabel(): string {
    const key =
      this.variantDisplayMode() === 'standard'
        ? 'browse.showVariantsStandard'
        : 'browse.showVariantsBoth';
    return this.translate.instant(key);
  }
  /** One entry per (card, variant) pair among the loaded page's own
   * card_catalog_variants -- what the grid renders in 'both' mode, same
   * pattern as set-detail.component.ts's variantTiles. Doesn't change which
   * cards are loaded, only how each is broken out. */
  get variantTiles(): {
    entry: CardCatalogEntry;
    variant: CardCatalogVariant;
  }[] {
    if (this.variantDisplayMode() === 'standard') {
      return [];
    }
    return buildVariantTiles(this.items(), (entry) => entry.variants);
  }
  variantTileLabel(variant: CardCatalogVariant): string {
    return VARIANT_LABELS[variant.variant_type];
  }
  /** Same resolution rule as set-detail.component.ts's variantTileImageUrl:
   * 'standard' reuses the catalog card's own thumbnail, every other variant
   * uses its own pokecardex scan (falling back to the catalog thumbnail if
   * that variant hasn't been scraped yet). */
  variantTileImageUrl(entry: CardCatalogEntry, variant: CardCatalogVariant): string {
    const path = this.variantImagePath(variant);
    return path ? this.catalogService.variantImageUrl(path) : this.thumbnailUrl(entry);
  }
  private variantImagePath(variant: CardCatalogVariant): string | null {
    if (variant.variant_type === 'standard') {
      return null;
    }
    const preferred =
      this.translate.currentLang() === 'fr' ? variant.image_path_fr : variant.image_path_us;
    return preferred ?? variant.image_path_fr ?? variant.image_path_us ?? null;
  }
  setView(view: BrowseView): void {
    this.view.set(view);
  }
  toggleFilters(): void {
    this.filtersOpen.set(!this.filtersOpen());
  }
  closeFilters(): void {
    this.filtersOpen.set(false);
  }
  imageUrl(entry: CardCatalogEntry, variant?: CardCatalogVariant | null): string {
    const path = variant ? this.variantImagePath(variant) : null;
    return path
      ? this.catalogService.variantImageUrl(path)
      : this.catalogService.imageUrl(entry.image_path);
  }
  thumbnailUrl(entry: CardCatalogEntry): string {
    return this.catalogService.thumbnailUrl(entry.image_path);
  }
  supertypeKey(value: string | null | undefined): string {
    return supertypeKeyFor(value);
  }
  addToCollection(entry: CardCatalogEntry): void {
    this.collectionAddListService.addCard(entry);
  }
  detailCard = signal<CardCatalogEntry | null>(null);
  detailVariant = signal<CardCatalogVariant | null>(null);
  openDetail(entry: CardCatalogEntry, variant?: CardCatalogVariant): void {
    this.detailCard.set(entry);
    this.detailVariant.set(variant ?? null);
  }
  closeDetail(): void {
    this.detailCard.set(null);
    this.detailVariant.set(null);
  }
  saveDetailName(name: string): void {
    if (!this.detailCard()) {
      return;
    }
    const entry = this.detailCard()!;
    this.catalogService.updateName(entry.id, name).subscribe({
      next: (updated) => {
        const index = this.items().findIndex((c) => c.id === updated.id);
        if (index !== -1) {
          this.items.update((value) => {
            const next = [...value];
            next[index] = updated;
            return next;
          });
        }
        this.detailCard.set(updated);
        this.toastService.show(
          this.translate.instant('browse.renamedCard', { name: updated.name }),
        );
      },
      error: (err) =>
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('browse.updateNameFailed'),
          'error',
        ),
    });
  }
}
