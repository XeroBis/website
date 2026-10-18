import { Icon } from '@shared';
import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { VariantType, VARIANT_LABELS } from '../../../models/card.model';
import { rarityIconUrl } from '../../../util/rarity-icons.util';
import { variantIconUrl } from '../../../util/variant-icons.util';
import { togglePrintSelection } from '../../../util/variant-display.util';

/** Shared personal/public set filter controls. Empty selections mean all. */
@Component({
  selector: 'app-set-filters',
  imports: [Icon, TranslatePipe],
  templateUrl: './set-filters.component.html',
  styleUrl: './set-filters.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetFiltersComponent {
  @Input() rarities: string[] = [];
  @Input() variants: VariantType[] = [];
  @Input() selectedRarities = new Set<string>();
  @Input() selectedVariants: VariantType[] = ['standard'];
  @Output() raritiesChange = new EventEmitter<Set<string>>();
  @Output() variantsChange = new EventEmitter<VariantType[]>();
  readonly variantLabels = VARIANT_LABELS;
  readonly variantIcon = variantIconUrl;
  readonly rarityIcon = rarityIconUrl;

  newSet(): Set<string> {
    return new Set<string>();
  }

  toggleRarity(rarity: string): void {
    const next = new Set(this.selectedRarities);
    if (next.has(rarity)) next.delete(rarity);
    else next.add(rarity);
    this.raritiesChange.emit(next);
  }

  toggleVariant(variant: VariantType | 'all'): void {
    this.variantsChange.emit(togglePrintSelection(this.selectedVariants, variant));
  }

  onRarityIconError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    img.nextElementSibling?.classList.add('visible');
  }
}
