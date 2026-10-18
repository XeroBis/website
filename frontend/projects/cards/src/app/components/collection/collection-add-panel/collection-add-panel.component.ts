import { signal } from '@angular/core';
import {
  effect,
  Component,
  EventEmitter,
  OnInit,
  Output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CardCatalogVariant, VARIANT_LABELS, VariantType } from '../../../models/card.model';
import { Deck } from '../../../models/deck.model';
import { CardsService } from '../../../services/cards.service';
import { CatalogService } from '../../../services/catalog.service';
import {
  CollectionAddEntry,
  CollectionAddListService,
} from '../../../services/collection-add-list.service';
import { DecksService } from '../../../services/decks.service';
import { ToastService } from '../../../services/toast.service';
import { CardDisplayNamePipe } from '../../../util/card-display-name.pipe';
@Component({
  selector: 'app-collection-add-panel',
  imports: [FormsModule, TranslatePipe, CardDisplayNamePipe],
  templateUrl: './collection-add-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './collection-add-panel.component.scss',
})
export class CollectionAddPanelComponent implements OnInit {
  @Output()
  added = new EventEmitter<void>();
  entries = signal<CollectionAddEntry[]>([]);
  decks = signal<Deck[]>([]);
  selectedDeckId = signal<number | null>(null);
  submitting = signal(false);
  expanded = signal(false);
  /** Available print variants per catalog card (see card_catalog_variants),
   * fetched lazily as entries appear -- drives the per-entry variant
   * dropdown. Keyed by catalogId. */
  variantsByCard = signal<Record<number, VariantType[]>>({});
  constructor(
    private readonly collectionAddListService: CollectionAddListService,
    private readonly cardsService: CardsService,
    private readonly catalogService: CatalogService,
    private readonly decksService: DecksService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
  ) {
    effect(() => {
      const entries = this.collectionAddListService.entries();
      this.entries.set(entries);
      for (const entry of entries) {
        this.loadVariantsFor(entry.catalogId);
      }
    });
  }
  ngOnInit(): void {
    this.decksService
      .list()
      .subscribe((decks) => this.decks.set(decks.filter((d) => d.deck_type !== 'phantom')));
  }
  private loadVariantsFor(catalogId: number): void {
    if (this.variantsByCard()[catalogId]) {
      return;
    }
    this.catalogService.getCardVariants(catalogId).subscribe((variants: CardCatalogVariant[]) => {
      this.variantsByCard.update((value) => {
        const next = { ...value };
        next[catalogId] = variants.map((v) => v.variant_type);
        return next;
      });
    });
  }
  variantOptionsFor(entry: CollectionAddEntry): VariantType[] {
    return this.variantsByCard()[entry.catalogId] ?? ['standard'];
  }
  variantLabel(v: VariantType): string {
    return VARIANT_LABELS[v];
  }
  increment(entry: CollectionAddEntry): void {
    this.collectionAddListService.updateQuantity(entry.key, entry.quantity + 1);
  }
  decrement(entry: CollectionAddEntry): void {
    this.collectionAddListService.updateQuantity(entry.key, entry.quantity - 1);
  }
  onVariantChange(entry: CollectionAddEntry, variantType: VariantType): void {
    this.collectionAddListService.setVariant(entry.key, variantType, false);
  }
  toggleAllVariants(entry: CollectionAddEntry, allVariants: boolean): void {
    this.collectionAddListService.setVariant(entry.key, entry.variantType, allVariants);
  }
  removeEntry(entry: CollectionAddEntry): void {
    this.collectionAddListService.remove(entry.key);
  }
  toggleExpanded(): void {
    this.expanded.set(!this.expanded());
  }
  clearList(): void {
    this.collectionAddListService.clear();
  }
  addToCollection(): void {
    if (this.entries().length === 0) {
      return;
    }
    this.submitting.set(true);
    const deckId = this.selectedDeckId()!;
    this.cardsService
      .bulkAdd({
        items: this.entries().map((e) => ({
          catalog_id: e.catalogId,
          variant_type: e.variantType,
          quantity: e.quantity,
          all_variants: e.allVariants,
        })),
        deck_id: deckId,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          const totalQuantity = this.entries().reduce((sum, e) => sum + e.quantity, 0);
          this.toastService.show(
            deckId
              ? this.translate.instant('panel.addedToCollectionWithDeck', {
                  unique: this.entries().length,
                  total: totalQuantity,
                  count: this.entries().length,
                  deckName: this.deckName(deckId),
                })
              : this.translate.instant('panel.addedToCollection', {
                  unique: this.entries().length,
                  total: totalQuantity,
                }),
          );
          this.collectionAddListService.clear();
          this.selectedDeckId.set(null);
          this.added.emit();
        },
        error: (err) => {
          this.submitting.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('panel.addToCollectionFailed'),
            'error',
          );
        },
      });
  }
  private deckName(deckId: number): string {
    return (
      this.decks().find((d) => d.id === deckId)?.name ??
      this.translate.instant('panel.theSelectedDeck')
    );
  }
}
