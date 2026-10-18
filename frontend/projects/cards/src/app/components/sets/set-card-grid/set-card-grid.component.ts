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
  view: 'grid' | 'checklist' | 'binder' = 'grid';
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
    this.binderPages.set([]);
    for (let start = 0; start < slots.length; start += 9) {
      const page: ({
        card: T;
        variant?: CardCatalogVariant;
      } | null)[] = slots.slice(start, start + 9);
      while (page.length < 9) page.push(null);
      this.binderPages.update((value) => {
        const next = [...value];
        next.push(page);
        return next;
      });
    }
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
  variantLabel(variant: CardCatalogVariant): string {
    return VARIANT_LABELS[variant.variant_type];
  }
  shortLabel(variant: CardCatalogVariant): string {
    return this.variantLabel(variant).replace(/^Reverse (?=.*Ball$)/, '');
  }
}
