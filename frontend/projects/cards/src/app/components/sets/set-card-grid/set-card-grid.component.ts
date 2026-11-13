import { signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, TemplateRef, ChangeDetectionStrategy } from '@angular/core';
import {
  CardCatalogVariant,
  VARIANT_LABELS,
  VARIANT_BADGES,
  VariantType,
} from '../../../models/card.model';
import { VariantDisplayMode } from '../../../util/variant-display.util';
import { CardDisplayNamePipe } from '../../../util/card-display-name.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { rarityCategory } from '../../../util/rarity-category.util';
import { rarityIconUrl } from '../../../util/rarity-icons.util';
import { variantIconUrl } from '../../../util/variant-icons.util';
import { CardTileComponent } from '../../shared/card-tile/card-tile.component';
/** Grid, checklist, nine-pocket (3×3) or twelve-pocket (4×3) binder. */
export type SetView = 'grid' | 'checklist' | 'binder' | 'binder12';
export interface SetGridCard {
  id: number;
  name: string;
  rarity: string | null;
}
export interface SetGridAdapter<T> {
  variants: (card: T) => CardCatalogVariant[];
  number: (card: T) => string;
  secret: (card: T) => boolean;
  image: (card: T, variant?: CardCatalogVariant) => string;
  quantity: (card: T, variant?: CardCatalogVariant) => number;
  reverse: (card: T) => number;
  /** Copies on incoming purchase lists (the owner's set page only). */
  incoming?: (card: T, variant?: CardCatalogVariant) => number;
  /** "Count incoming as owned" is on: incoming copies show as owned (no
   * badge, not greyed); off, they get the "Incoming ×N" badge. */
  countIncoming?: () => boolean;
  open: (card: T, variant?: CardCatalogVariant) => void;
}
/** Shared layout; each page supplies ownership and image access for its context. */
@Component({
  selector: 'app-set-card-grid',
  standalone: true,
  imports: [CommonModule, CardTileComponent, CardDisplayNamePipe, TranslatePipe],
  templateUrl: './set-card-grid.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './set-card-grid.component.scss',
})
export class SetCardGridComponent<T extends SetGridCard> implements OnChanges {
  @Input({ required: true })
  cards: T[] = [];
  @Input({ required: true })
  adapter!: SetGridAdapter<T>;
  @Input()
  view: SetView = 'grid';
  @Input()
  checklistControls: TemplateRef<{
    $implicit: T;
    variant: CardCatalogVariant;
  }> | null = null;
  @Input()
  mode: VariantDisplayMode = 'standard';
  @Input()
  interactive = false;
  @Input()
  localizeNames = false;
  @Input()
  controls: TemplateRef<{
    $implicit: T;
    variant?: CardCatalogVariant;
  }> | null = null;
  binderPages = signal<
    ({
      card: T;
      variant?: CardCatalogVariant;
    } | null)[][]
  >([]);
  ngOnChanges(): void {
    const slots =
      this.mode === 'standard'
        ? this.cards.map((card) => ({ card }))
        : this.cards.flatMap((card) =>
            this.adapter.variants(card).map((variant) => ({ card, variant })),
          );
    const size = this.view === 'binder12' ? 12 : 9;
    const pages: ({
      card: T;
      variant?: CardCatalogVariant;
    } | null)[][] = [];
    for (let start = 0; start < slots.length; start += size) {
      const page: ({
        card: T;
        variant?: CardCatalogVariant;
      } | null)[] = slots.slice(start, start + size);
      while (page.length < size) page.push(null);
      pages.push(page);
    }
    this.binderPages.set(pages);
  }
  get variantTypes(): VariantType[] {
    const present = new Set(
      this.cards.flatMap((card) => this.adapter.variants(card).map((v) => v.variant_type)),
    );
    return (Object.keys(VARIANT_LABELS) as VariantType[]).filter((type) => present.has(type));
  }
  variant(card: T, type: VariantType): CardCatalogVariant | undefined {
    return this.adapter.variants(card).find((v) => v.variant_type === type);
  }
  readonly variantIcon = variantIconUrl;
  variantBadge(type: VariantType): string {
    return VARIANT_BADGES[type] || 'Std';
  }
  variantTypeLabel(type: VariantType): string {
    return VARIANT_LABELS[type];
  }
  readonly rarityCategory = rarityCategory;
  readonly rarityIcon = rarityIconUrl;
  onRarityIconError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    img.nextElementSibling?.classList.add('visible');
  }
  /** The "Incoming ×N" badge count: 0 while incoming copies count as owned. */
  incomingQty(card: T, variant?: CardCatalogVariant): number {
    return this.adapter.countIncoming?.() ? 0 : (this.adapter.incoming?.(card, variant) ?? 0);
  }
  /** Greyed out: no copy owned, nor incoming while those count as owned. */
  notOwned(card: T, variant?: CardCatalogVariant): boolean {
    if (this.adapter.quantity(card, variant) > 0) {
      return false;
    }
    return !(this.adapter.countIncoming?.() && (this.adapter.incoming?.(card, variant) ?? 0) > 0);
  }
  variantLabel(variant: CardCatalogVariant): string {
    return VARIANT_LABELS[variant.variant_type];
  }
  shortLabel(variant: CardCatalogVariant): string {
    return this.variantLabel(variant).replace(/^Reverse (?=.*Ball$)/, '');
  }
}
