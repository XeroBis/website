import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { VariantType } from '../../../models/card.model';
import { PrintFiltersComponent } from '../../shared/print-filters/print-filters.component';

/** Shared personal/public set filter controls. Empty selections mean all. */
@Component({
  selector: 'app-set-filters',
  imports: [PrintFiltersComponent],
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

  get selectedRarityList(): string[] {
    return [...this.selectedRarities];
  }

  toSet(rarities: string[]): Set<string> {
    return new Set(rarities);
  }
}
