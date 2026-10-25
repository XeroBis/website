import { Icon } from '@shared';
import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { VariantType, VARIANT_LABELS } from '../../../models/card.model';
import { rarityIconUrl } from '../../../util/rarity-icons.util';
import { variantIconUrl } from '../../../util/variant-icons.util';
import { isMainVariant, togglePrintSelection } from '../../../util/variant-display.util';

/** The rarity and print icon rows shared by the set pages and the
 * Browse/Collection filter panel. Each row starts with an "all" button;
 * an empty selection means all. */
@Component({
  selector: 'app-print-filters',
  imports: [Icon, TranslatePipe],
  templateUrl: './print-filters.component.html',
  styleUrl: './print-filters.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrintFiltersComponent {
  @Input() rarities: string[] = [];
  @Input() variants: VariantType[] = [];
  @Input() selectedRarities: string[] = [];
  @Input() selectedVariants: VariantType[] = [];
  /** Shows a group label above each row (the filter panel) instead of a
   * divider between rows (the set pages). */
  @Input() labeled = false;
  @Input() variantLabel = 'filters.printVariant';
  /** Show only the main prints (plus any selected one) until "+" is pressed. */
  @Input() collapseVariants = false;
  @Output() raritiesChange = new EventEmitter<string[]>();
  @Output() variantsChange = new EventEmitter<VariantType[]>();
  showAllVariants = false;
  readonly variantLabels = VARIANT_LABELS;
  readonly variantIcon = variantIconUrl;
  readonly rarityIcon = rarityIconUrl;

  get shownVariants(): VariantType[] {
    if (!this.collapseVariants || this.showAllVariants) {
      return this.variants;
    }
    return this.variants.filter((v) => isMainVariant(v) || this.selectedVariants.includes(v));
  }

  get hiddenVariantCount(): number {
    return this.variants.length - this.shownVariants.length;
  }

  toggleRarity(rarity: string | 'all'): void {
    this.raritiesChange.emit(togglePrintSelection(this.selectedRarities, rarity));
  }

  toggleVariant(variant: VariantType | 'all'): void {
    this.variantsChange.emit(togglePrintSelection(this.selectedVariants, variant));
  }

  /** No icon dropped in for this category yet: hide the broken image and
   * show the text badge behind it. */
  onRarityIconError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    img.nextElementSibling?.classList.add('visible');
  }
}
