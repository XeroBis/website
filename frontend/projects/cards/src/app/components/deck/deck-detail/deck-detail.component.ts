import { Icon } from '@shared';
import { signal } from '@angular/core';
import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CardCatalogEntry, VARIANT_BADGES, VariantType } from '../../../models/card.model';
import { Deck, DeckCard, DeckDetail, DeckExportMode } from '../../../models/deck.model';
import { CardNameService } from '../../../services/card-name.service';
import { CatalogService } from '../../../services/catalog.service';
import { DecksService } from '../../../services/decks.service';
import { ToastService } from '../../../services/toast.service';
import {
  computeEnergyBadges,
  computeSupertypeCounts,
  energyIconUrl as toEnergyIconUrl,
  EnergyBadge,
  isBasicEnergy,
  posterSlots,
  SupertypeCounts,
} from '../../../util/deck-visuals';
import { supertypeKey as supertypeKeyFor } from '../../../util/card-type-translate.util';
import { CardDisplayNamePipe } from '../../../util/card-display-name.pipe';
import { sortCards, SortOption } from '../../../util/sort.util';
import { CardDetailComponent } from '../../shared/card-detail/card-detail.component';
import { DeckActionsComponent } from '../deck-actions/deck-actions.component';
import { DeckUpgradeDraftsComponent } from '../deck-upgrade-drafts/deck-upgrade-drafts.component';
import { ModalComponent } from '../../shared/modal/modal.component';
type DeckView = 'grid' | 'table';
@Component({
  selector: 'app-deck-detail',
  imports: [
    Icon,
    FormsModule,
    RouterLink,
    DeckActionsComponent,
    DeckUpgradeDraftsComponent,
    ModalComponent,
    CardDetailComponent,
    TranslatePipe,
    CardDisplayNamePipe,
  ],
  templateUrl: './deck-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './deck-detail.component.scss',
})
export class DeckDetailComponent implements OnInit {
  deck = signal<DeckDetail | null>(null);
  view = signal<DeckView>('grid');
  loading = signal(false);
  energyBadges = signal<EnergyBadge[]>([]);
  supertypeCounts = signal<SupertypeCounts>({ pokemon: 0, trainer: 0, energy: 0 });
  /** Only 'name_asc'/'supertype' are offered here -- a two-state switch, not
   * a dropdown, see documentation/features.md's "Sort". */
  sort = signal<SortOption>('name_asc');
  /** Phantom-deck-only view filter -- same "full/missing/not_available"
   * choice the export modal offers, but for what's shown on screen. Always
   * starts back on "full" when the page is (re)opened, same as the export
   * modal always resetting to "full" -- not persisted. */
  wantListFilter = signal<DeckExportMode>('full');
  startHandOpen = signal(false);
  startHand = signal<DeckCard[]>([]);
  detailCard = signal<CardCatalogEntry | null>(null);
  detailLoading = signal(false);
  /** The phantom want-list row whose "allocated elsewhere" tooltip is
   * currently shown, and where to render it. `position: fixed`, positioned
   * from the trigger's bounding rect rather than CSS-anchored to it, since
   * the table view's horizontally-scrolling wrapper forces its vertical
   * overflow to clip too (see deck-detail.component.scss) -- a fixed
   * element escapes that ancestor clipping entirely. */
  hoveredAllocationCard = signal<DeckCard | null>(null);
  allocationTooltipTop = signal(0);
  allocationTooltipLeft = signal(0);
  private deckId!: number;
  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly decksService: DecksService,
    private readonly catalogService: CatalogService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
    private readonly cardNameService: CardNameService,
  ) {}
  get isPhantom(): boolean {
    return this.deck()?.deck_type === 'phantom';
  }
  get isNormal(): boolean {
    return this.deck()?.deck_type === 'normal';
  }
  supertypeKey(value: string | null | undefined): string {
    return supertypeKeyFor(value);
  }
  ngOnInit(): void {
    this.deckId = Number(this.route.snapshot.paramMap.get('id'));
    this.load();
  }
  load(showLoading = true): void {
    if (showLoading) {
      this.loading.set(true);
    }
    this.decksService.get(this.deckId).subscribe({
      next: (deck) => {
        this.applyDeck(deck);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
  private applyDeck(deck: DeckDetail): void {
    this.deck.set(deck);
    this.energyBadges.set(computeEnergyBadges(deck.cards));
    this.supertypeCounts.set(computeSupertypeCounts(deck.cards));
  }
  get posterSlots(): (DeckCard | null)[] {
    return posterSlots(this.deck()?.poster_cards ?? []);
  }
  setSort(sort: SortOption): void {
    this.sort.set(sort);
  }
  get sortedCards(): DeckCard[] {
    if (!this.deck()) {
      return [];
    }
    const cards = this.isPhantom
      ? this.filteredWantListCards(this.deck()!.cards)
      : this.deck()!.cards;
    return sortCards(cards, this.sort(), (card) => this.cardNameService.displayName(card.name));
  }
  /** Mirrors the backend's export "missing"/"not_available" filtering (see
   * routers/decks.py's `_deck_cards_for_export`) -- view-only, doesn't
   * change the deck's totals/hand-fan/energy badges, which stay based on
   * the full want-list regardless of this filter. */
  private filteredWantListCards(cards: DeckCard[]): DeckCard[] {
    if (this.wantListFilter() === 'full') {
      return cards;
    }
    return cards.filter((dc) =>
      this.wantListFilter() === 'missing'
        ? (dc.owned ?? 0) < dc.quantity_in_deck
        : (dc.available ?? 0) < dc.quantity_in_deck,
    );
  }
  energyIconUrl(icon: string): string {
    return toEnergyIconUrl(icon);
  }
  /** No cap for a phantom deck's want-list (and Basic Energy is always uncapped). */
  maxQuantity(cardName: string): number | null {
    return this.isPhantom || isBasicEnergy(cardName) ? null : 4;
  }
  variantBadge(dc: DeckCard): string {
    return VARIANT_BADGES[dc.variant_type as VariantType] ?? '';
  }
  /** Sum of quantity_in_deck across every variant row this card holds in the
   * deck -- the 4-copy cap is a card-level rule, not per-variant (see
   * documentation/data-model.md's "Variant-aware deck allocation"). */
  private cardTotalInDeck(dc: DeckCard): number {
    if (!this.deck()) {
      return dc.quantity_in_deck;
    }
    return this.deck()!
      .cards.filter((other) => this.idFor(other) === this.idFor(dc))
      .reduce((sum, other) => sum + other.quantity_in_deck, 0);
  }
  setView(view: DeckView): void {
    this.view.set(view);
  }
  thumbnailUrl(imagePath: string): string {
    return this.catalogService.thumbnailUrl(imagePath);
  }
  /** Full-res image -- used for the card detail modal only, see
   * CatalogService.thumbnailUrl's docstring. */
  imageUrl(imagePath: string): string {
    return this.catalogService.imageUrl(imagePath);
  }
  /** The id to key the per-card add/update/remove endpoints on: `card_id` for
   * normal rows, `catalog_id` for phantom rows (phantom rows have no `card_id`). */
  private idFor(dc: DeckCard): number {
    return (this.isPhantom ? dc.catalog_id : dc.card_id)!;
  }
  stepQuantity(dc: DeckCard, delta: number): void {
    const max = this.maxQuantity(dc.name);
    const next = dc.quantity_in_deck + delta;
    const cardNext = this.cardTotalInDeck(dc) - dc.quantity_in_deck + next;
    if (next < 1 || (max !== null && cardNext > max)) {
      return;
    }
    this.updateQuantity(dc, next);
  }
  updateQuantity(dc: DeckCard, quantity: number): void {
    if (quantity < 1) {
      return;
    }
    this.decksService.updateCard(this.deckId, dc.id, { quantity_in_deck: quantity }).subscribe({
      next: () => this.load(false),
      error: (err) =>
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('decks.updateQuantityFailed'),
          'error',
        ),
    });
  }
  removeCard(dc: DeckCard): void {
    this.decksService.removeCard(this.deckId, dc.id).subscribe({
      next: () => this.load(false),
      error: (err) =>
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('decks.removeCardFailed'),
          'error',
        ),
    });
  }
  openDetail(dc: DeckCard): void {
    if (dc.catalog_id == null) {
      return;
    }
    this.detailLoading.set(true);
    this.catalogService.getById(dc.catalog_id).subscribe({
      next: (entry) => {
        this.detailLoading.set(false);
        this.detailCard.set(entry);
      },
      error: () => {
        this.detailLoading.set(false);
      },
    });
  }
  closeDetail(): void {
    this.detailCard.set(null);
  }
  showAllocationTooltip(event: MouseEvent | FocusEvent, dc: DeckCard): void {
    if (!dc.allocated_decks.length) {
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.allocationTooltipTop.set(rect.top);
    this.allocationTooltipLeft.set(rect.left + rect.width / 2);
    this.hoveredAllocationCard.set(dc);
  }
  hideAllocationTooltip(): void {
    this.hoveredAllocationCard.set(null);
  }
  openStartHand(): void {
    this.startHandOpen.set(true);
    this.drawStartHand();
  }
  closeStartHand(): void {
    this.startHandOpen.set(false);
  }
  drawStartHand(): void {
    if (!this.deck()) {
      return;
    }
    const pool: DeckCard[] = [];
    for (const dc of this.deck()!.cards) {
      for (let i = 0; i < dc.quantity_in_deck; i++) {
        pool.push(dc);
      }
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.startHand.set(pool.slice(0, 7));
  }
  onRenamed(deck: Deck): void {
    if (this.deck()!) {
      this.deck.update((value) => {
        if (!value) return value;
        const next = { ...value };
        next.name = deck.name;
        return next;
      });
      this.deck.update((value) => {
        if (!value) return value;
        const next = { ...value };
        next.poster_cards = deck.poster_cards;
        return next;
      });
    }
  }
  onCopied(deck: Deck): void {
    this.router.navigate(['/decks', deck.id]);
  }
  onDeleted(): void {
    this.router.navigate(['/decks']);
  }
  onDraftApplied(deck: DeckDetail): void {
    this.applyDeck(deck);
  }
}
