import { Icon } from '@shared';
import { signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, Inject, OnInit, PLATFORM_ID, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CardSet, Share, VariantType, VARIANT_LABELS } from '../../../models/card.model';
import { CatalogService } from '../../../services/catalog.service';
import { SharesService } from '../../../services/shares.service';
import { ToastService } from '../../../services/toast.service';
import { loadStoredFilters, saveStoredFilters } from '../../../util/filter-storage.util';
import { rarityCategories, rawRaritiesForCategory } from '../../../util/rarity-category.util';
import { variantIconUrl } from '../../../util/variant-icons.util';
import { rarityIconUrl } from '../../../util/rarity-icons.util';
import { DEFAULT_SET_RARITIES, DEFAULT_SET_VARIANTS } from '../../../util/set-filter-defaults.util';
import { MissingExportModalComponent } from '../missing-export-modal/missing-export-modal.component';
import { ModalComponent } from '../../shared/modal/modal.component';
interface SetsGroup {
  series: string;
  displayName: string;
  sets: CardSet[];
}
interface SetsListFilters {
  search: string;
}
const FILTERS_STORAGE_KEY = 'pokemon-cards:sets-filters';
/** The DATA folder names are stable grouping keys, not necessarily the
 * viewer-facing French labels. Keep this small fallback here so the Series
 * headings react immediately when the account locale finishes loading,
 * even if the Sets API response was initiated while it was still English. */
const FRENCH_SERIES_NAMES: Record<string, string> = {
  'Mega Evolution': 'Méga-Évolution',
  'World Championships': 'Championnats du Monde',
  'Scarlet & Violet': 'Écarlate et Violet',
};
@Component({
  selector: 'app-sets-list',
  imports: [
    Icon,
    CommonModule,
    FormsModule,
    RouterLink,
    TranslatePipe,
    ModalComponent,
    MissingExportModalComponent,
  ],
  templateUrl: './sets-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sets-list.component.scss',
})
export class SetsListComponent implements OnInit {
  sets = signal<CardSet[]>([]);
  loading = signal(true);
  search = signal('');
  rarityCategories = signal<string[]>([]);
  readonly quickRarities = DEFAULT_SET_RARITIES;
  selectedRarityCategories = signal<string[]>([...this.quickRarities]);
  filtersOpen = signal(false);
  variantsOpen = signal(false);
  private readonly visibleVariants = new Set<VariantType>([
    'reverse',
    'reverse_pokeball',
    'reverse_friendball',
    'reverse_loveball',
    'reverse_duskball',
    'reverse_quickball',
    'reverse_rocketball',
    'reverse_masterball',
  ]);
  get otherRarities(): string[] {
    return this.rarityCategories().filter((category) => !this.quickRarities.includes(category));
  }
  get printVariantTypes(): VariantType[] {
    return this.variantTypes().filter(
      (variant) => variant === 'standard' || this.visibleVariants.has(variant),
    );
  }
  get otherVariantTypes(): VariantType[] {
    return this.variantTypes().filter(
      (variant) => variant !== 'standard' && !this.visibleVariants.has(variant),
    );
  }
  selectedVariants = signal<VariantType[]>([...DEFAULT_SET_VARIANTS]);
  variantTypes = signal<VariantType[]>([]);
  readonly variantLabels = VARIANT_LABELS;
  readonly variantIcon = variantIconUrl;
  exportOpen = signal(false);
  sharesModalOpen = signal(false);
  sharesLoading = signal(false);
  shares = signal<Share[]>([]);
  revokingShareIds = signal(new Set<number>());
  private readonly isBrowser: boolean;
  constructor(
    private readonly catalogService: CatalogService,
    private readonly sharesService: SharesService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
    @Inject(PLATFORM_ID)
    platformId: object,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }
  ngOnInit(): void {
    this.restoreFilters();
    this.catalogService.listRarities().subscribe((rarities) => {
      this.rarityCategories.set(rarityCategories(rarities));
    });
    this.catalogService.listVariantTypes().subscribe((types) => {
      this.variantTypes.set(['standard', ...types]);
    });
    this.reloadSets();
  }
  private restoreFilters(): void {
    const saved = loadStoredFilters<SetsListFilters>(this.isBrowser, FILTERS_STORAGE_KEY);
    if (!saved) {
      return;
    }
    this.search.set(saved.search ?? '');
  }
  onSearchChange(): void {
    saveStoredFilters(this.isBrowser, FILTERS_STORAGE_KEY, { search: this.search() });
  }
  /** Guards against out-of-order responses: clicking several filter chips
   * in quick succession fires one request per click, and since these are
   * plain (non-async) FastAPI endpoints Starlette runs in a threadpool, a
   * later request can resolve before an earlier one -- without this, the
   * earlier request's response could land last and silently overwrite the
   * latest selection's result with a stale one. Only the response matching
   * the most recently *sent* request is ever applied. */
  private reloadSetsRequestId = 0;
  private reloadSets(): void {
    this.loading.set(true);
    const requestId = ++this.reloadSetsRequestId;
    const rarities = this.selectedRarityCategories().flatMap((category) =>
      rawRaritiesForCategory(category),
    );
    this.catalogService.listSets(rarities, this.selectedVariants()).subscribe((sets) => {
      if (requestId !== this.reloadSetsRequestId) {
        return;
      }
      this.sets.set(sets);
      this.loading.set(false);
    });
  }
  toggleRarityCategory(category: string): void {
    this.selectedRarityCategories.set(
      this.isRarityCategoryActive(category)
        ? this.selectedRarityCategories().filter((value) => value !== category)
        : [...this.selectedRarityCategories(), category],
    );
    this.reloadSets();
  }
  isRarityCategoryActive(category: string): boolean {
    return this.selectedRarityCategories().includes(category);
  }
  isAllRarityCategoriesActive(): boolean {
    return this.selectedRarityCategories().length === 0;
  }
  toggleAllRarityCategories(): void {
    this.selectedRarityCategories.set([]);
    this.reloadSets();
  }
  selectVariant(variant: VariantType | 'all'): void {
    this.selectedVariants.set(
      variant === 'all'
        ? []
        : this.selectedVariants().includes(variant)
          ? this.selectedVariants().filter((value) => value !== variant)
          : [...this.selectedVariants(), variant],
    );
    this.reloadSets();
  }
  rarityIcon(category: string): string {
    return rarityIconUrl(category);
  }
  /** No icon dropped in for this rarity category yet
   * (frontend/public/rarity-icons is filled in incrementally) -- hide the
   * broken image and fall back to the text badge sitting right behind it in
   * the template, same pattern as the set detail page's rarity row. */
  onRarityIconError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    img.nextElementSibling?.classList.add('visible');
  }
  openSharesModal(): void {
    this.sharesModalOpen.set(true);
    this.sharesLoading.set(true);
    this.sharesService.list().subscribe({
      next: (shares) => {
        this.shares.set(shares);
        this.sharesLoading.set(false);
      },
      error: () => {
        this.sharesLoading.set(false);
        this.toastService.show(this.translate.instant('sets.sharesLoadFailed'), 'error');
      },
    });
  }
  closeSharesModal(): void {
    this.sharesModalOpen.set(false);
  }
  revokeShare(share: Share): void {
    if (!confirm(this.translate.instant('sets.revokeShareConfirm'))) {
      return;
    }
    this.revokingShareIds.update((value) => {
      const next = new Set(value);
      next.add(share.id);
      return next;
    });
    this.sharesService.revoke(share.id).subscribe({
      next: (updated) => {
        this.revokingShareIds.update((value) => {
          const next = new Set(value);
          next.delete(share.id);
          return next;
        });
        const index = this.shares().findIndex((s) => s.id === updated.id);
        if (index !== -1) {
          this.shares.update((value) => {
            const next = [...value];
            next[index] = updated;
            return next;
          });
        }
      },
      error: () => {
        this.revokingShareIds.update((value) => {
          const next = new Set(value);
          next.delete(share.id);
          return next;
        });
        this.toastService.show(this.translate.instant('sets.revokeShareFailed'), 'error');
      },
    });
  }
  isRevoking(share: Share): boolean {
    return this.revokingShareIds().has(share.id);
  }
  shareStatusKey(share: Share): string {
    return `sets.shareStatus${share.status.charAt(0).toUpperCase()}${share.status.slice(1)}`;
  }
  /** Grouped by series (literally the DATA/<series>/ folder each set was
   * imported from, see CardSet's `series` field) -- both series and sets
   * are already in display order since listSets() sorts by release_date
   * desc -- Map preserves insertion order. */
  get groups(): SetsGroup[] {
    const bySeries = new Map<string, CardSet[]>();
    for (const set of this.sets()) {
      const series = set.series ?? '';
      const group = bySeries.get(series);
      if (group) {
        group.push(set);
      } else {
        bySeries.set(series, [set]);
      }
    }
    const term = this.search().trim().toLowerCase();
    const groups: SetsGroup[] = [];
    for (const [series, sets] of bySeries) {
      const displayName = this.seriesDisplayName(series, sets[0].series_display_name);
      const seriesMatches =
        !term || series.toLowerCase().includes(term) || displayName.toLowerCase().includes(term);
      const matchingSets = seriesMatches
        ? sets
        : sets.filter(
            (set) =>
              set.set_name.toLowerCase().includes(term) ||
              (set.set_name_fr?.toLowerCase().includes(term) ?? false) ||
              set.set_code.toLowerCase().includes(term),
          );
      if (matchingSets.length > 0) {
        groups.push({ series, displayName, sets: matchingSets });
      }
    }
    return groups;
  }
  logoUrl(set: CardSet): string {
    return this.logoCandidates(set)[0] ?? '';
  }
  private seriesDisplayName(series: string, apiDisplayName: string | null): string {
    if (this.translate.currentLang() === 'fr') {
      return FRENCH_SERIES_NAMES[series] ?? apiDisplayName ?? series;
    }
    return series;
  }
  symbolUrl(set: CardSet): string {
    return this.symbolCandidates(set)[0] ?? '';
  }
  private symbolCandidates(set: CardSet): string[] {
    return set.symbol_path ? [this.catalogService.imageUrl(set.symbol_path)] : [];
  }
  /** Ordered fallback: French logo first (if the UI is in French), then the
   * English logo, then the symbol. */
  private logoCandidates(set: CardSet): string[] {
    const logos =
      this.translate.currentLang() === 'fr' ? [set.logo_path_fr, set.logo_path] : [set.logo_path];
    const logoUrls = logos
      .filter((path): path is string => !!path)
      .map((path) => this.catalogService.imageUrl(path));
    return [...logoUrls, ...this.symbolCandidates(set)];
  }
  /** Advances an <img> to the next candidate URL on load error, tracking
   * position via a dataset index; hides the image once candidates run out. */
  private advance(img: HTMLImageElement, candidates: string[]): void {
    const next = Number(img.dataset['fallbackIdx'] ?? '0') + 1;
    if (next < candidates.length) {
      img.dataset['fallbackIdx'] = String(next);
      img.src = candidates[next];
    } else {
      img.style.visibility = 'hidden';
    }
  }
  /** The badge is purely decorative -- unlike the main logo, no symbol
   * fallback, just hides itself on error. */
  hideBadge(event: Event, set: CardSet): void {
    this.advance(event.target as HTMLImageElement, this.symbolCandidates(set));
  }
  /** Some sets have a symbol but no logo (mostly Trainer Kits) -- fall back
   * to the symbol before giving up and hiding the tile's image entirely,
   * rather than showing nothing for a set that's actually matched. */
  onLogoError(event: Event, set: CardSet): void {
    this.advance(event.target as HTMLImageElement, this.logoCandidates(set));
  }
}
