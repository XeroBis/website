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
import { Card, CardCatalogVariant, VARIANT_LABELS, VariantType } from '../../../models/card.model';
import { Deck } from '../../../models/deck.model';
import { CardsService } from '../../../services/cards.service';
import { CatalogService } from '../../../services/catalog.service';
import { DeckListEntry, DeckListService } from '../../../services/deck-list.service';
import { DecksService } from '../../../services/decks.service';
import { ToastService } from '../../../services/toast.service';
import { CardDisplayNamePipe } from '../../../util/card-display-name.pipe';
@Component({
  selector: 'app-deck-list-panel',
  imports: [FormsModule, TranslatePipe, CardDisplayNamePipe],
  templateUrl: './deck-list-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './deck-list-panel.component.scss',
})
export class DeckListPanelComponent implements OnInit {
  @Output()
  added = new EventEmitter<void>();
  entries = signal<DeckListEntry[]>([]);
  decks = signal<Deck[]>([]);
  selectedDeckId = signal<number | null>(null);
  submitting = signal(false);
  expanded = signal(false);
  /** Available print variants per catalog card, fetched lazily as entries
   * appear -- drives the per-entry variant dropdown, same pattern as
   * CollectionAddPanelComponent. Keyed by catalogId. */
  variantsByCard = signal<Record<number, VariantType[]>>({});
  constructor(
    private readonly deckListService: DeckListService,
    private readonly cardsService: CardsService,
    private readonly catalogService: CatalogService,
    private readonly decksService: DecksService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
  ) {
    effect(() => {
      const entries = this.deckListService.entries();
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
  variantOptionsFor(entry: DeckListEntry): VariantType[] {
    return this.variantsByCard()[entry.catalogId] ?? ['standard'];
  }
  variantLabel(v: VariantType): string {
    return VARIANT_LABELS[v];
  }
  onVariantChange(entry: DeckListEntry, variantType: VariantType): void {
    this.withCard(entry, (card) =>
      this.deckListService.setVariant(entry.key, card, variantType, false),
    );
  }
  toggleAllVariants(entry: DeckListEntry, allVariants: boolean): void {
    this.withCard(entry, (card) =>
      this.deckListService.setVariant(entry.key, card, entry.variantType, allVariants),
    );
  }
  private withCard(entry: DeckListEntry, fn: (card: Card) => void): void {
    this.cardsService.get(entry.cardId).subscribe(fn);
  }
  increment(entry: DeckListEntry): void {
    this.deckListService.updateQuantity(entry.key, entry.quantity + 1);
  }
  decrement(entry: DeckListEntry): void {
    this.deckListService.updateQuantity(entry.key, entry.quantity - 1);
  }
  removeEntry(entry: DeckListEntry): void {
    this.deckListService.remove(entry.key);
  }
  toggleExpanded(): void {
    this.expanded.set(!this.expanded());
  }
  clearList(): void {
    this.deckListService.clear();
  }
  addToDeck(): void {
    if (!this.selectedDeckId()! || this.entries().length === 0) {
      return;
    }
    this.submitting.set(true);
    this.decksService
      .bulkAddCards(this.selectedDeckId()!, {
        items: this.entries().map((e) => ({
          card_id: e.cardId,
          variant_type: e.variantType,
          all_variants: e.allVariants,
          quantity_in_deck: e.quantity,
        })),
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          const totalQuantity = this.entries().reduce((sum, e) => sum + e.quantity, 0);
          this.toastService.show(
            this.translate.instant('panel.addedToDeck', {
              unique: this.entries().length,
              total: totalQuantity,
            }),
          );
          this.deckListService.clear();
          this.added.emit();
        },
        error: (err) => {
          this.submitting.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('panel.addToDeckFailed'),
            'error',
          );
        },
      });
  }
}
