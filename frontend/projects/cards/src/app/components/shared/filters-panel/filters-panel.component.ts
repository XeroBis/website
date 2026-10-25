import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { CardSet, VariantType } from '../../../models/card.model';
import { supertypeKey as supertypeKeyFor } from '../../../util/card-type-translate.util';
import { SORT_OPTIONS, SortOption } from '../../../util/sort.util';
import { PrintFiltersComponent } from '../print-filters/print-filters.component';

const MOBILE_BREAKPOINT_PX = 900;

/** Fixed, always-shown card-type toggle buttons -- a closed set in
 * card_catalog.supertype. */
const CARD_TYPES = ['Pokémon', 'Trainer', 'Energy'];

@Component({
  selector: 'app-filters-panel',
  imports: [FormsModule, TranslatePipe, PrintFiltersComponent],
  templateUrl: './filters-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './filters-panel.component.scss',
})
export class FiltersPanelComponent implements OnChanges {
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  @Input() open = false;
  @Input() cardCountLabel = '';
  @Input() hasActiveFilters = false;
  @Input() showSetTextFilter = false;
  @Input() showAvailableFilter = false;
  /** Renders as a plain block in normal document flow instead of a
   * viewport-fixed slide-out aside -- for embedding the same filter
   * controls inside another component's own layout (e.g. a modal) rather
   * than as the page-level Browse/Collection filter sidebar. */
  @Input() inline = false;

  /** Only set_code/set_name are used here -- Pick<> rather than the full
   * CardSet lets Collection's own locally-derived (set_code, set_name) list
   * bind directly, without fabricating series/card_count/release_date. */
  @Input() sets: Pick<CardSet, 'set_code' | 'set_name'>[] = [];
  /** Rarity *categories* (see rarity-category.util.ts), not raw
   * card_catalog.rarity values -- the parent is expected to have already
   * reduced whatever rarity list it has through rarityCategories(). */
  @Input() rarities: string[] = [];
  readonly sortOptions = SORT_OPTIONS;
  readonly cardTypes = CARD_TYPES;

  @Input() search = '';
  @Output() searchChange = new EventEmitter<string>();

  @Input() setCode = '';
  @Output() setCodeChange = new EventEmitter<string>();

  @Input() setFilter = '';
  @Output() setFilterChange = new EventEmitter<string>();

  /** Empty array means "no explicit selection" -- nothing is filtered out,
   * so every button in the group renders unselected. Picking one or more
   * values narrows the grid down to only those types (multi-select OR). */
  @Input() supertype: string[] = [];
  @Output() supertypeChange = new EventEmitter<string[]>();

  @Input() rarity: string[] = [];
  @Output() rarityChange = new EventEmitter<string[]>();

  /** Non-standard variant_types to render as toggle buttons -- the parent
   * decides the set (Browse: every variant_type present anywhere in the
   * catalog; Collection: every variant_type actually owned) and the
   * semantics of what selecting one narrows to (catalog existence vs.
   * ownership) -- this component only renders/toggles the selection. */
  @Input() variantOptions: VariantType[] = [];
  @Input() variantFilterLabel = 'filters.printVariant';
  @Input() variantType: VariantType[] = [];
  /** Show only the main prints (plus any selected one) until "+" is pressed. */
  @Input() collapseVariants = false;
  @Output() variantTypeChange = new EventEmitter<VariantType[]>();

  @Input() available: '' | 'available' | 'unavailable' = '';
  @Output() availableChange = new EventEmitter<'' | 'available' | 'unavailable'>();

  @Input() cardNumber = '';
  @Output() cardNumberChange = new EventEmitter<string>();

  @Input() sort: SortOption = 'name_asc';
  @Output() sortChange = new EventEmitter<SortOption>();

  @Output() filterChange = new EventEmitter<void>();
  @Output() clear = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']?.currentValue && window.innerWidth <= MOBILE_BREAKPOINT_PX) {
      this.searchInput?.nativeElement.focus();
    }
  }

  get filteredSets(): Pick<CardSet, 'set_code' | 'set_name'>[] {
    const term = this.setFilter.trim().toLowerCase();
    if (!term) {
      return this.sets;
    }
    return this.sets.filter((set) => set.set_name.toLowerCase().includes(term));
  }

  isSupertypeActive(value: string): boolean {
    return this.supertype.includes(value);
  }

  supertypeKey(value: string): string {
    return supertypeKeyFor(value);
  }

  onSearchChange(value: string): void {
    this.searchChange.emit(value);
    this.filterChange.emit();
  }

  onSetCodeChange(value: string): void {
    this.setCodeChange.emit(value);
    this.filterChange.emit();
  }

  onSetFilterChange(value: string): void {
    this.setFilterChange.emit(value);
    this.filterChange.emit();
  }

  toggleSupertype(value: string): void {
    const active = this.supertype.includes(value);
    const next = active ? this.supertype.filter((v) => v !== value) : [...this.supertype, value];
    this.supertypeChange.emit(next);
    this.filterChange.emit();
  }

  onRarityChange(next: string[]): void {
    this.rarityChange.emit(next);
    this.filterChange.emit();
  }

  onVariantTypeChange(next: VariantType[]): void {
    this.variantTypeChange.emit(next);
    this.filterChange.emit();
  }

  onAvailableChange(value: '' | 'available' | 'unavailable'): void {
    this.availableChange.emit(value);
    this.filterChange.emit();
  }

  onCardNumberChange(value: string): void {
    this.cardNumberChange.emit(value);
    this.filterChange.emit();
  }

  onSortChange(value: SortOption): void {
    this.sortChange.emit(value);
    this.filterChange.emit();
  }
}
