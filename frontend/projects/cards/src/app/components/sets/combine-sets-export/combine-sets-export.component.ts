import { Icon } from '@shared';
import { signal } from '@angular/core';
import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CardSet } from '../../../models/card.model';
import { CatalogService } from '../../../services/catalog.service';
import { ToastService } from '../../../services/toast.service';
import { rawRaritiesForCategory } from '../../../util/rarity-category.util';
import { rarityIconUrl } from '../../../util/rarity-icons.util';
import { ModalComponent } from '../../shared/modal/modal.component';
/** "Combine sets export" -- lets the user pick several sets on the Sets
 * page and export one combined "missing cards" decklist, with a single
 * rarity/format/language/exclude-in-deck selection applying across every
 * selected set at once -- see documentation/features.md's "Combined sets
 * missing-cards export". Launched from a button in the Sets page header,
 * next to "Mes partages". Mirrors the set detail page's own "Export
 * missing cards" modal (`SetDetailComponent`) for the export-options step,
 * and the Deck Upgrade Drafts "Combine drafts export"
 * (`MultiDraftExportComponent`) for the two-step picker/export modal
 * shape. */
@Component({
  selector: 'app-combine-sets-export',
  imports: [Icon, FormsModule, ModalComponent, TranslatePipe],
  templateUrl: './combine-sets-export.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './combine-sets-export.component.scss',
})
export class CombineSetsExportComponent {
  /** Every set on the page, in the same category/release-date display
   * order the page's own sections already use -- passed down rather than
   * fetched again since the parent SetsListComponent already loads it. */
  @Input()
  sets: CardSet[] = [];
  /** Every rarity category present anywhere in the catalog, same list the
   * page's own completion-filter row uses -- passed down for the same
   * reason as `sets` above. */
  @Input()
  rarityCategories: string[] = [];
  pickerOpen = signal(false);
  pickerSearch = signal('');
  selectedCodes = signal(new Set<string>());
  exportOpen = signal(false);
  exportSelectedRarities = signal(new Set<string>());
  exportFormat = signal<'tcgplayer' | 'cardmarket'>('cardmarket');
  exportLanguage = signal<'en' | 'fr'>('en');
  exportExcludeInDeck = signal(false);
  exporting = signal(false);
  constructor(
    private readonly catalogService: CatalogService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
  ) {}
  openPicker(): void {
    this.pickerOpen.set(true);
    this.pickerSearch.set('');
    this.selectedCodes.set(new Set());
  }
  closePicker(): void {
    this.pickerOpen.set(false);
  }
  get filteredSets(): CardSet[] {
    const term = this.pickerSearch().trim().toLowerCase();
    if (!term) {
      return this.sets;
    }
    return this.sets.filter(
      (set) =>
        set.set_name.toLowerCase().includes(term) ||
        (set.set_name_fr?.toLowerCase().includes(term) ?? false) ||
        (set.series?.toLowerCase().includes(term) ?? false),
    );
  }
  toggleSelected(set: CardSet): void {
    if (this.selectedCodes().has(set.set_code)) {
      this.selectedCodes.update((value) => {
        const next = new Set(value);
        next.delete(set.set_code);
        return next;
      });
    } else {
      this.selectedCodes.update((value) => {
        const next = new Set(value);
        next.add(set.set_code);
        return next;
      });
    }
  }
  isSelected(set: CardSet): boolean {
    return this.selectedCodes().has(set.set_code);
  }
  get selectedCount(): number {
    return this.selectedCodes().size;
  }
  goToExportStep(): void {
    if (this.selectedCount === 0) {
      return;
    }
    this.exportSelectedRarities.set(new Set());
    this.exportFormat.set('cardmarket');
    this.exportLanguage.set('en');
    this.exportExcludeInDeck.set(false);
    this.pickerOpen.set(false);
    this.exportOpen.set(true);
  }
  backToPicker(): void {
    if (this.exporting()) {
      return;
    }
    this.exportOpen.set(false);
    this.pickerOpen.set(true);
  }
  closeExport(): void {
    if (!this.exporting()) {
      this.exportOpen.set(false);
    }
  }
  toggleExportRarity(category: string): void {
    if (this.exportSelectedRarities().has(category)) {
      this.exportSelectedRarities.update((value) => {
        const next = new Set(value);
        next.delete(category);
        return next;
      });
    } else {
      this.exportSelectedRarities.update((value) => {
        const next = new Set(value);
        next.add(category);
        return next;
      });
    }
  }
  isExportRarityActive(category: string): boolean {
    return this.exportSelectedRarities().has(category);
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
  rarityIcon(category: string): string {
    return rarityIconUrl(category);
  }
  onRarityIconError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    img.nextElementSibling?.classList.add('visible');
  }
  /** Copies a TCGplayer/PTCGL- or Cardmarket-format decklist of every card
   * missing across every selected set to the clipboard -- same
   * rarity/format/language/exclude-in-deck semantics as the single-set
   * export, just applied to the pooled `selectedCodes` instead of one set.
   * Since each card belongs to exactly one set, there's no cross-set
   * pooling of *demand* the way the combined draft export needs -- this is
   * just every selected set's own missing list, concatenated. */
  exportMissing(): void {
    this.exporting.set(true);
    const rawRarities = [...this.exportSelectedRarities()].flatMap((category) =>
      rawRaritiesForCategory(category),
    );
    this.catalogService
      .exportMultiSetMissingText(
        Array.from(this.selectedCodes()),
        rawRarities,
        this.exportFormat(),
        this.exportLanguage(),
        this.exportExcludeInDeck(),
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
              this.exportOpen.set(false);
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
