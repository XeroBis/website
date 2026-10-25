import { Icon } from '@shared';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  computed,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject, switchMap } from 'rxjs';
import {
  CardSet,
  SetMissingSummary,
  VARIANT_LABELS,
  VariantType,
} from '../../../models/card.model';
import { CatalogService } from '../../../services/catalog.service';
import { CountIncomingService } from '../../../services/count-incoming.service';
import { ToastService } from '../../../services/toast.service';
import { rawRaritiesForCategory } from '../../../util/rarity-category.util';
import { rarityIconUrl } from '../../../util/rarity-icons.util';
import { variantIconUrl } from '../../../util/variant-icons.util';
import { ModalComponent } from '../../shared/modal/modal.component';

/** Prints shown up front; the others sit behind a "+N" button. */
const MAIN_VARIANTS = new Set<VariantType>([
  'standard',
  'reverse',
  'reverse_pokeball',
  'reverse_friendball',
  'reverse_loveball',
  'reverse_duskball',
  'reverse_quickball',
  'reverse_rocketball',
  'reverse_masterball',
]);

/** The one "Export missing cards" modal (documentation/features.md, Sets):
 * opened for one set (`setCode`) from its page, or from the Sets page with
 * `sets`, where a grid of the sets with something missing for the chosen
 * options, with their missing count and %, sits under those options. */
@Component({
  selector: 'app-missing-export-modal',
  imports: [Icon, FormsModule, ModalComponent, TranslatePipe],
  templateUrl: './missing-export-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './missing-export-modal.component.scss',
})
export class MissingExportModalComponent implements OnInit {
  /** Single-set mode: no grid, this set only. */
  @Input() setCode: string | null = null;
  /** Grid mode: every set, in the Sets page's order. */
  @Input() sets: CardSet[] = [];
  @Input() rarityCategories: string[] = [];
  @Input() variantTypes: VariantType[] = [];
  @Output() closed = new EventEmitter<void>();

  readonly variantLabels = VARIANT_LABELS;
  readonly variantIcon = variantIconUrl;
  selectedVariants = signal(new Set<VariantType>(['standard']));
  selectedRarities = signal(new Set<string>());
  format = signal<'tcgplayer' | 'cardmarket'>('cardmarket');
  language = signal<'en' | 'fr'>('en');
  excludeInDeck = signal(false);
  otherVariantsOpen = signal(false);
  search = signal('');
  selectedCodes = signal(new Set<string>());
  summary = signal(new Map<string, SetMissingSummary>());
  loading = signal(true);
  exporting = signal(false);
  private readonly reload$ = new Subject<void>();

  readonly visibleSets = computed(() => {
    const summary = this.summary();
    const term = this.search().trim().toLowerCase();
    return this.sets.filter(
      (set) =>
        summary.has(set.set_code) &&
        (!term ||
          set.set_name.toLowerCase().includes(term) ||
          (set.set_name_fr?.toLowerCase().includes(term) ?? false) ||
          (set.series?.toLowerCase().includes(term) ?? false)),
    );
  });

  /** `visibleSets` by series, in the Sets page's order. */
  readonly groups = computed(() => {
    const groups = new Map<string, { series: string; name: string; sets: CardSet[] }>();
    for (const set of this.visibleSets()) {
      const series = set.series ?? '';
      let group = groups.get(series);
      if (!group) {
        group = { series, name: set.series_display_name ?? series, sets: [] };
        groups.set(series, group);
      }
      group.sets.push(set);
    }
    return [...groups.values()];
  });
  /** Series are collapsed until opened; a search shows every match. */
  expandedSeries = signal(new Set<string>());

  constructor(
    private readonly catalogService: CatalogService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
    readonly countIncoming: CountIncomingService,
  ) {}

  ngOnInit(): void {
    if (this.setCode) this.selectedCodes.set(new Set([this.setCode]));
    this.reload$
      .pipe(
        switchMap(() => {
          this.loading.set(true);
          return this.catalogService.missingSummary(
            this.rawRarities(),
            [...this.selectedVariants()],
            this.excludeInDeck(),
            this.countIncoming.enabled(),
            this.setCode ? [this.setCode] : [],
          );
        }),
      )
      .subscribe({
        next: (rows) => {
          const summary = new Map(rows.map((row) => [row.set_code, row]));
          this.summary.set(summary);
          // A ticked set with nothing left to export drops out of the grid.
          if (!this.setCode) {
            this.selectedCodes.update(
              (codes) => new Set([...codes].filter((code) => summary.has(code))),
            );
          }
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
    this.reload$.next();
  }

  get otherVariants(): VariantType[] {
    return this.variantTypes.filter((v) => !MAIN_VARIANTS.has(v));
  }
  /** Other prints stay listed while one of them is selected. */
  get shownOtherVariants(): VariantType[] {
    return this.otherVariants.filter(
      (v) => this.otherVariantsOpen() || this.selectedVariants().has(v),
    );
  }
  get shownVariants(): VariantType[] {
    return [...this.variantTypes.filter((v) => MAIN_VARIANTS.has(v)), ...this.shownOtherVariants];
  }
  get hiddenOtherCount(): number {
    return this.otherVariants.length - this.shownOtherVariants.length;
  }

  /** At least one print stays selected. */
  toggleVariant(variant: VariantType): void {
    const next = new Set(this.selectedVariants());
    if (next.has(variant)) {
      if (next.size === 1) return;
      next.delete(variant);
    } else {
      next.add(variant);
    }
    this.selectedVariants.set(next);
    this.reload$.next();
  }
  toggleRarity(category: string): void {
    const next = new Set(this.selectedRarities());
    if (next.has(category)) next.delete(category);
    else next.add(category);
    this.selectedRarities.set(next);
    this.reload$.next();
  }
  clearRarities(): void {
    this.selectedRarities.set(new Set());
    this.reload$.next();
  }
  toggleExcludeInDeck(): void {
    this.excludeInDeck.update((value) => !value);
    this.reload$.next();
  }
  toggleCountIncoming(): void {
    this.countIncoming.toggle();
    this.reload$.next();
  }

  toggleSet(code: string): void {
    const next = new Set(this.selectedCodes());
    if (next.has(code)) next.delete(code);
    else next.add(code);
    this.selectedCodes.set(next);
  }
  selectAllVisible(): void {
    this.selectedCodes.update(
      (codes) => new Set([...codes, ...this.visibleSets().map((set) => set.set_code)]),
    );
  }
  isExpanded(series: string): boolean {
    return !!this.search().trim() || this.expandedSeries().has(series);
  }
  toggleExpanded(series: string): void {
    const next = new Set(this.expandedSeries());
    if (next.has(series)) next.delete(series);
    else next.add(series);
    this.expandedSeries.set(next);
  }
  selectedInGroup(sets: CardSet[]): number {
    const codes = this.selectedCodes();
    return sets.filter((set) => codes.has(set.set_code)).length;
  }
  groupMissing(sets: CardSet[]): number {
    const summary = this.summary();
    return sets.reduce((sum, set) => sum + (summary.get(set.set_code)?.missing ?? 0), 0);
  }
  /** Ticks every set of the series, or unticks them all when all are ticked. */
  toggleGroup(sets: CardSet[]): void {
    const all = this.selectedInGroup(sets) === sets.length;
    const next = new Set(this.selectedCodes());
    for (const set of sets) {
      if (all) next.delete(set.set_code);
      else next.add(set.set_code);
    }
    this.selectedCodes.set(next);
  }
  clearSelection(): void {
    this.selectedCodes.set(new Set());
  }

  get singleSummary(): SetMissingSummary | null {
    return this.setCode ? (this.summary().get(this.setCode) ?? null) : null;
  }
  get selectedMissing(): number {
    const summary = this.summary();
    return [...this.selectedCodes()].reduce(
      (sum, code) => sum + (summary.get(code)?.missing ?? 0),
      0,
    );
  }

  rarityIcon(category: string): string {
    return rarityIconUrl(category);
  }
  onRarityIconError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    img.nextElementSibling?.classList.add('visible');
  }
  /** French logo first (UI in French), then the English one, then the symbol. */
  private logoCandidates(set: CardSet): string[] {
    const paths =
      this.translate.currentLang() === 'fr'
        ? [set.logo_path_fr, set.logo_path, set.symbol_path]
        : [set.logo_path, set.symbol_path];
    return paths
      .filter((path): path is string => !!path)
      .map((path) => this.catalogService.imageUrl(path));
  }
  logoUrl(set: CardSet): string {
    return this.logoCandidates(set)[0] ?? '';
  }
  onLogoError(event: Event, set: CardSet): void {
    const img = event.target as HTMLImageElement;
    const candidates = this.logoCandidates(set);
    const next = Number(img.dataset['fallbackIdx'] ?? '0') + 1;
    if (next < candidates.length) {
      img.dataset['fallbackIdx'] = String(next);
      img.src = candidates[next];
    } else {
      img.style.visibility = 'hidden';
    }
  }

  private rawRarities(): string[] {
    return [...this.selectedRarities()].flatMap((category) => rawRaritiesForCategory(category));
  }

  close(): void {
    if (!this.exporting()) this.closed.emit();
  }

  /** Copies the export of the ticked sets (or the one set) to the
   * clipboard, in lists of up to 150 cards. */
  exportMissing(): void {
    if (this.selectedCodes().size === 0) return;
    this.exporting.set(true);
    this.catalogService
      .exportMissingText(
        [...this.selectedCodes()],
        this.rawRarities(),
        [...this.selectedVariants()],
        this.format(),
        this.language(),
        this.excludeInDeck(),
        this.countIncoming.enabled(),
      )
      .subscribe({
        next: (text) => {
          this.exporting.set(false);
          if (!text) {
            this.toastService.show(this.translate.instant('sets.exportMissingEmpty'));
            return;
          }
          navigator.clipboard.writeText(text).then(
            () => {
              this.toastService.show(this.translate.instant('sets.exportMissingCopied'));
              this.closed.emit();
            },
            () =>
              this.toastService.show(
                this.translate.instant('sets.exportMissingCopyFailed'),
                'error',
              ),
          );
        },
        error: () => {
          this.exporting.set(false);
          this.toastService.show(this.translate.instant('sets.exportMissingFailed'), 'error');
        },
      });
  }
}
