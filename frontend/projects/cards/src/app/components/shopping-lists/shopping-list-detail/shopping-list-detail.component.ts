import { signal } from '@angular/core';
import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ShoppingListCard, ShoppingListDetail } from '../../../models/shopping-list.model';
import { CatalogService } from '../../../services/catalog.service';
import { ShoppingListService } from '../../../services/shopping-list.service';
import { ToastService } from '../../../services/toast.service';
import { ModalComponent } from '../../shared/modal/modal.component';
type CardFilter = 'all' | 'missing' | 'fully_got';
type SortDirection = 'asc' | 'desc';
type NameLanguage = 'en' | 'fr';
@Component({
  selector: 'app-shopping-list-detail',
  imports: [FormsModule, RouterModule, ModalComponent, TranslatePipe],
  templateUrl: './shopping-list-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './shopping-list-detail.component.scss',
})
export class ShoppingListDetailComponent implements OnInit {
  shoppingList = signal<ShoppingListDetail | null>(null);
  loading = signal(false);
  search = signal('');
  filter = signal<CardFilter>('all');
  sortDirection = signal<SortDirection>('asc');
  nameLanguage = signal<NameLanguage>('en');
  pasteOpen = signal(false);
  pasteText = signal('');
  pasting = signal(false);
  removeTarget = signal<ShoppingListCard | null>(null);
  removing = signal(false);
  pendingCards = signal(new Set<number>());
  private shoppingListId!: number;
  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly shoppingListService: ShoppingListService,
    private readonly catalogService: CatalogService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
  ) {}
  ngOnInit(): void {
    this.nameLanguage.set(this.translate.currentLang() === 'fr' ? 'fr' : 'en');
    this.shoppingListId = Number(this.route.snapshot.paramMap.get('id'));
    this.load();
  }
  load(): void {
    this.loading.set(true);
    this.shoppingListService.get(this.shoppingListId).subscribe({
      next: (detail) => {
        this.shoppingList.set(detail);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toastService.show(this.translate.instant('shoppingLists.detail.loadFailed'), 'error');
        this.router.navigate(['/shopping-lists']);
      },
    });
  }
  displayName(card: ShoppingListCard): string {
    return this.nameLanguage() === 'fr' ? card.name_fr : card.name_en;
  }
  imageUrl(card: ShoppingListCard): string {
    return this.catalogService.thumbnailUrl(card.image_path);
  }
  get filteredCards(): ShoppingListCard[] {
    if (!this.shoppingList()) {
      return [];
    }
    const term = this.search().trim().toLowerCase();
    let cards = this.shoppingList()!.cards;
    if (term) {
      cards = cards.filter((c) => this.displayName(c).toLowerCase().includes(term));
    }
    if (this.filter() === 'missing') {
      cards = cards.filter((c) => c.quantity_owned < c.quantity_needed);
    } else if (this.filter() === 'fully_got') {
      cards = cards.filter((c) => c.quantity_owned === c.quantity_needed);
    }
    return [...cards].sort((a, b) => {
      const cmp = this.displayName(a).localeCompare(this.displayName(b));
      return this.sortDirection() === 'asc' ? cmp : -cmp;
    });
  }
  isFullyGot(card: ShoppingListCard): boolean {
    return card.quantity_owned === card.quantity_needed;
  }
  openPaste(): void {
    this.pasteText.set('');
    this.pasteOpen.set(true);
  }
  closePaste(): void {
    if (!this.pasting()) {
      this.pasteOpen.set(false);
    }
  }
  submitPaste(): void {
    if (!this.pasteText().trim()) {
      return;
    }
    this.pasting.set(true);
    this.shoppingListService.pasteMore(this.shoppingListId, this.pasteText()).subscribe({
      next: (result) => {
        this.pasting.set(false);
        this.pasteOpen.set(false);
        this.shoppingList.set(result.shopping_list);
        this.toastService.show(
          this.translate.instant('shoppingLists.detail.pasteAdded', { count: result.lines_added }),
        );
        if (result.lines_skipped > 0) {
          this.toastService.show(
            this.translate.instant('shoppingLists.linesSkipped', { count: result.lines_skipped }),
            'error',
          );
        }
      },
      error: (err) => {
        this.pasting.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('shoppingLists.detail.pasteFailed'),
          'error',
        );
      },
    });
  }
  changeQuantityOwned(card: ShoppingListCard, delta: number): void {
    const next = card.quantity_owned + delta;
    if (next < 0 || next > card.quantity_needed || this.pendingCards().has(card.id)) {
      return;
    }
    this.pendingCards.update((ids) => new Set(ids).add(card.id));
    const done = () =>
      this.pendingCards.update((ids) => {
        const next = new Set(ids);
        next.delete(card.id);
        return next;
      });
    this.shoppingListService.updateCardQuantity(this.shoppingListId, card.id, next).subscribe({
      next: (updated) => {
        done();
        this.shoppingList.update((list) => {
          if (!list) return list;
          const cards = list.cards.map((row) => (row.id === updated.id ? updated : row));
          return {
            ...list,
            cards,
            fully_got_cards: cards.filter((row) => this.isFullyGot(row)).length,
          };
        });
      },
      error: (err) => {
        done();
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('shoppingLists.detail.quantityUpdateFailed'),
          'error',
        );
      },
    });
  }

  openRemoveConfirm(card: ShoppingListCard): void {
    this.removeTarget.set(card);
  }
  closeRemoveConfirm(): void {
    if (!this.removing()) {
      this.removeTarget.set(null);
    }
  }
  confirmRemove(): void {
    if (!this.removeTarget()! || !this.shoppingList()!) {
      return;
    }
    const cardId = this.removeTarget()!.id;
    this.removing.set(true);
    this.shoppingListService.removeCard(this.shoppingListId, cardId).subscribe({
      next: () => {
        this.removing.set(false);
        this.shoppingList.update((list) => {
          if (!list) return list;
          const cards = list.cards.filter((card) => card.id !== cardId);
          return {
            ...list,
            cards,
            total_cards: cards.length,
            total_quantity_needed: cards.reduce((sum, card) => sum + card.quantity_needed, 0),
            fully_got_cards: cards.filter((card) => this.isFullyGot(card)).length,
          };
        });
        this.toastService.show(this.translate.instant('shoppingLists.detail.removed'));
        this.removeTarget.set(null);
      },
      error: (err) => {
        this.removing.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('shoppingLists.detail.removeCardFailed'),
          'error',
        );
      },
    });
  }
}
