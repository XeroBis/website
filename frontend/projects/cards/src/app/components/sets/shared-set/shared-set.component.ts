import { Icon } from '@shared';
import { signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
  CardCatalogVariant,
  SharedSet,
  SharedSetCard,
  VariantType,
} from '../../../models/card.model';
import { PublicSharesService } from '../../../services/shares.service';
import { SetCardGridComponent, SetGridAdapter } from '../set-card-grid/set-card-grid.component';
import { SetFiltersComponent } from '../set-filters/set-filters.component';
import { rarityCategory, sortRarityCategories } from '../../../util/rarity-category.util';
import { DEFAULT_SET_RARITIES, DEFAULT_SET_VARIANTS } from '../../../util/set-filter-defaults.util';
import { matchesCatalogSearch, parseAnchoredSearch } from '../../../util/pokemon-translations.util';
import {
  buildVariantTiles,
  completionPercent,
  VariantDisplayMode,
  printSelectionMode,
  selectDisplayedPrints,
} from '../../../util/variant-display.util';
/** Public, unauthenticated read-only view of one set's completion status,
 * reached via a share link -- see documentation/features.md's "Share a
 * set". Deliberately self-contained: every HTTP call (the set data itself,
 * and every card thumbnail/set logo/symbol) goes through
 * PublicSharesService's token-scoped endpoints, never CatalogService's
 * authenticated image URLs -- see documentation/decisions.md's
 * "Set Sharing" for why images are also served token-scoped rather than
 * opening up /api/cards/images/ itself. No card-detail modal, no navigation to
 * any other page. */
@Component({
  selector: 'app-shared-set',
  imports: [
    Icon,
    CommonModule,
    FormsModule,
    TranslatePipe,
    SetCardGridComponent,
    SetFiltersComponent,
  ],
  templateUrl: './shared-set.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './shared-set.component.scss',
})
export class SharedSetComponent implements OnInit {
  loading = signal(true);
  notFound = signal(false);
  set = signal<SharedSet | null>(null);
  private token = '';
  search = signal('');
  missingOnly = signal(false);
  duplicatesOnly = signal(false);
  view = signal<'grid' | 'checklist' | 'binder'>('grid');
  get countsVariants(): boolean {
    return this.view() === 'checklist' || this.variantDisplayMode() !== 'standard';
  }
  selectedRarities = signal(new Set(DEFAULT_SET_RARITIES));
  selectedVariants = signal<VariantType[]>([...DEFAULT_SET_VARIANTS]);
  get variantTypes(): VariantType[] {
    return [
      ...new Set(
        (this.set()?.cards ?? []).flatMap((card) => card.print_variants.map((v) => v.variant_type)),
      ),
    ];
  }
  /** Layout follows the same selection rule as personal set detail. */
  variantDisplayMode = signal<VariantDisplayMode>(printSelectionMode(this.selectedVariants()));
  readonly gridAdapter: SetGridAdapter<SharedSetCard> = {
    variants: (card) => this.displayedVariants(card),
    number: (card) =>
      /^\d+$/.test(card.card_number) && this.set()?.card_count
        ? card.card_number.padStart(String(this.set()!.card_count).length, '0') +
          '/' +
          this.set()!.card_count
        : card.card_number,
    secret: (card) =>
      /^\d+$/.test(card.card_number) &&
      Boolean(this.set()?.card_count) &&
      Number(card.card_number) > (this.set()?.card_count ?? 0),
    image: (card, variant) =>
      variant ? this.variantTileImageUrl(card, variant) : this.thumbnailUrl(card),
    quantity: (card, variant) =>
      variant ? this.variantTileOwnedQuantity(card, variant) : this.standardQuantity(card),
    reverse: (card) => this.reverseTotal(card),
    open: (card, variant) => undefined,
  };
  constructor(
    private readonly route: ActivatedRoute,
    private readonly publicSharesService: PublicSharesService,
  ) {}
  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    this.publicSharesService.get(this.token).subscribe({
      next: (set) => {
        this.set.set(set);
        this.loading.set(false);
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
  }
  get availableRarities(): string[] {
    const seen = new Set<string>();
    for (const card of this.set()?.cards ?? []) {
      if (card.rarity) {
        seen.add(rarityCategory(card.rarity));
      }
    }
    return sortRarityCategories(seen);
  }
  /** Owned quantity across every non-'standard' variant. */
  reverseTotal(card: SharedSetCard): number {
    return card.variants
      .filter((v) => v.variant_type !== 'standard')
      .reduce((sum, v) => sum + v.quantity, 0);
  }
  get filteredCards(): SharedSetCard[] {
    const { term: numberTerm } = parseAnchoredSearch(this.search().trim().toLowerCase());
    return (this.set()?.cards ?? []).filter((card) => {
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
      return (
        (!!numberTerm && card.card_number.toLowerCase().includes(numberTerm)) ||
        matchesCatalogSearch(card.name, this.search())
      );
    });
  }
  get completionPercent(): number {
    const filtered = this.filteredCards;
    const owned = filtered.filter((card) => this.standardQuantity(card) > 0).length;
    return completionPercent(owned, filtered.length);
  }
  standardQuantity(card: SharedSetCard): number {
    return card.variants.find((variant) => variant.variant_type === 'standard')?.quantity ?? 0;
  }
  onRaritiesChange(rarities: Set<string>): void {
    this.selectedRarities.set(rarities);
  }
  onVariantsChange(variants: VariantType[]): void {
    this.selectedVariants.set(variants);
    this.variantDisplayMode.set(printSelectionMode(variants));
  }
  /** One entry per (card, variant) pair among filteredCards' own
   * print_variants -- what the grid renders in 'both' mode, same as the
   * owner's set detail page. */
  get variantTiles(): {
    entry: SharedSetCard;
    variant: CardCatalogVariant;
  }[] {
    if (!this.countsVariants) {
      return [];
    }
    return buildVariantTiles(this.filteredCards, (entry) => this.displayedVariants(entry));
  }
  variantTileImageUrl(entry: SharedSetCard, variant: CardCatalogVariant): string {
    if (variant.variant_type === 'standard') {
      return this.thumbnailUrl(entry);
    }
    const path = variant.image_path_fr ?? variant.image_path_us;
    return path
      ? this.publicSharesService.variantImageUrl(this.token, path)
      : this.thumbnailUrl(entry);
  }
  displayedVariants(entry: SharedSetCard): CardCatalogVariant[] {
    return selectDisplayedPrints(
      entry.print_variants,
      this.selectedVariants(),
      this.duplicatesOnly(),
      (variant) => this.variantTileOwnedQuantity(entry, variant),
    ).filter(
      (variant) => !this.missingOnly() || this.variantTileOwnedQuantity(entry, variant) <= 0,
    );
  }
  variantTileOwnedQuantity(entry: SharedSetCard, variant: CardCatalogVariant): number {
    return entry.variants.find((v) => v.variant_type === variant.variant_type)?.quantity ?? 0;
  }
  get displayedCount(): number {
    return this.countsVariants ? this.variantTiles.length : this.filteredCards.length;
  }
  get displayedCompletionPercent(): number {
    if (!this.countsVariants) {
      return this.completionPercent;
    }
    const tiles = this.variantTiles;
    const owned = tiles.filter((t) => this.variantTileOwnedQuantity(t.entry, t.variant) > 0).length;
    return completionPercent(owned, tiles.length);
  }
  thumbnailUrl(card: SharedSetCard): string {
    return this.publicSharesService.thumbnailUrl(this.token, card.image_path);
  }
  logoUrl(): string {
    return this.publicSharesService.logoUrl(this.token);
  }
  /** Same logo-then-symbol fallback as the owner's set-detail page. */
  onLogoError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img.dataset['fallback'] !== 'symbol') {
      img.dataset['fallback'] = 'symbol';
      img.src = this.publicSharesService.symbolUrl(this.token);
      return;
    }
    img.style.visibility = 'hidden';
  }
}
