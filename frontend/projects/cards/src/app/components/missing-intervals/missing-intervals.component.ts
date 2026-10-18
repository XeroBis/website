import { signal } from '@angular/core';
import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import {
  CardSet,
  MissingCardInterval,
  MissingSetIntervals,
  VariantType,
  VARIANT_LABELS,
} from '../../models/card.model';
import { CatalogService } from '../../services/catalog.service';
import { rarityCategories, rawRaritiesForCategory } from '../../util/rarity-category.util';
import { rarityIconUrl } from '../../util/rarity-icons.util';
import { variantIconUrl } from '../../util/variant-icons.util';
interface MissingSetGroup {
  series: string;
  displayName: string;
  sets: MissingSetIntervals[];
}
@Component({
  selector: 'app-missing-intervals',
  imports: [TranslatePipe],
  templateUrl: './missing-intervals.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './missing-intervals.component.scss',
})
export class MissingIntervalsComponent implements OnInit {
  sets = signal<MissingSetIntervals[]>([]);
  rarityCategories = signal<string[]>([]);
  readonly quickRarities = ['Common', 'Uncommon', 'Rare'];
  get otherRarities(): string[] {
    return this.rarityCategories().filter((category) => !this.quickRarities.includes(category));
  }
  selectedRarityCategories = signal(new Set<string>(['Common', 'Uncommon']));
  /** Set groups are intentionally collapsed on arrival, keeping the bulk
   * shopping view compact until a symbol is selected. */
  expandedSetCodes = signal(new Set<string>());
  printVariantTypes = signal<VariantType[]>(['standard']);
  otherVariantTypes = signal<VariantType[]>([]);
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
  readonly variantLabels = VARIANT_LABELS;
  readonly variantIcon = variantIconUrl;
  selectedVariant = signal<VariantType | null>('standard');
  filtersOpen = signal(false);
  loading = signal(true);
  private requestId = 0;
  /** Use GET /api/cards/catalog/sets as the one source for set-asset paths, the
   * same response the Sets page renders. Missing-intervals deliberately
   * owns only its compact ID data, not a second asset-path convention. */
  private readonly setsByCode = new Map<string, CardSet>();
  private catalogSetOrder: CardSet[] = [];
  constructor(private readonly catalogService: CatalogService) {}
  ngOnInit(): void {
    forkJoin({
      rarities: this.catalogService.listRarities(),
      sets: this.catalogService.listSets(),
      variants: this.catalogService.listVariantTypes(),
    }).subscribe(({ rarities, sets, variants }) => {
      this.printVariantTypes.set([
        'standard',
        ...variants.filter((variant) => this.visibleVariants.has(variant)),
      ]);
      this.otherVariantTypes.set(
        variants.filter((variant) => variant !== 'standard' && !this.visibleVariants.has(variant)),
      );
      this.rarityCategories.set(rarityCategories(rarities));
      this.catalogSetOrder = sets;
      for (const set of sets) {
        this.setsByCode.set(set.set_code, set);
      }
      this.reload();
    });
  }
  reload(): void {
    this.loading.set(true);
    const requestId = ++this.requestId;
    const rarities = [...this.selectedRarityCategories()].flatMap(rawRaritiesForCategory);
    this.catalogService.listMissingIntervals(rarities, this.selectedVariant()).subscribe((sets) => {
      if (requestId !== this.requestId) {
        return;
      }
      this.sets.set(sets);
      this.loading.set(false);
    });
  }
  toggleRarity(category: string): void {
    if (this.selectedRarityCategories().has(category)) {
      this.selectedRarityCategories.update((value) => {
        const next = new Set(value);
        next.delete(category);
        return next;
      });
    } else {
      this.selectedRarityCategories.update((value) => {
        const next = new Set(value);
        next.add(category);
        return next;
      });
    }
    this.reload();
  }
  clearRarities(): void {
    if (this.selectedRarityCategories().size === 0) {
      return;
    }
    this.selectedRarityCategories.set(new Set());
    this.reload();
  }
  toggleVariant(variant: VariantType): void {
    this.selectedVariant.set(this.selectedVariant() === variant ? null : variant);
    this.reload();
  }
  get selectedSet(): MissingSetIntervals | undefined {
    return this.sets().find((set) => this.expandedSetCodes().has(set.set_code));
  }
  toggleSet(setCode: string): void {
    if (this.expandedSetCodes().has(setCode)) {
      this.expandedSetCodes.update((value) => {
        const next = new Set(value);
        next.delete(setCode);
        return next;
      });
    } else {
      this.expandedSetCodes.set(new Set([setCode]));
    }
  }
  rarityIcon(category: string): string {
    return rarityIconUrl(category);
  }
  onRarityIconError(event: Event): void {
    const image = event.target as HTMLImageElement;
    image.style.display = 'none';
    image.nextElementSibling?.classList.add('visible');
  }
  symbolUrl(set: MissingSetIntervals): string | null {
    const symbolPath = this.setsByCode.get(set.set_code)?.symbol_path;
    return symbolPath ? this.catalogService.imageUrl(symbolPath) : null;
  }
  rangeLabel(interval: MissingCardInterval): string {
    return interval.start_number === interval.end_number
      ? String(interval.start_number)
      : `${interval.start_number} – ${interval.end_number}`;
  }
  /** Keep the same series grouping and newest-first/WDC-last ordering that
   * GET /api/cards/catalog/sets supplies to the Sets page. */
  get groups(): MissingSetGroup[] {
    const missingByCode = new Map(this.sets().map((set) => [set.set_code, set]));
    const groups = new Map<string, MissingSetGroup>();
    for (const catalogSet of this.catalogSetOrder) {
      const missingSet = missingByCode.get(catalogSet.set_code);
      if (!missingSet) {
        continue;
      }
      const series = catalogSet.series ?? '';
      let group = groups.get(series);
      if (!group) {
        group = {
          series,
          displayName: catalogSet.series_display_name ?? series,
          sets: [],
        };
        groups.set(series, group);
      }
      group.sets.push(missingSet);
    }
    return [...groups.values()];
  }
}
