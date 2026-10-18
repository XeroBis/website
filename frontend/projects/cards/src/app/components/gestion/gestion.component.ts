import { AuthService } from '@shared';
import { inject } from '@angular/core';
import { httpErrorMessage as errorMessage } from '@shared';
import { signal } from '@angular/core';
import { readJson } from '@shared';
import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { CollectionHistoryEntry } from '../../models/card.model';
import { CardsService } from '../../services/cards.service';
import { CatalogService } from '../../services/catalog.service';
import { CombatsService } from '../../services/combats.service';
import { DeckListService } from '../../services/deck-list.service';
import { DecksService } from '../../services/decks.service';
import { PurchasesService } from '../../services/purchases.service';
import { ToastService } from '../../services/toast.service';
import { CardDisplayNamePipe } from '../../util/card-display-name.pipe';
import { downloadBlob } from '@shared';
import { GestionActionComponent } from '../shared/gestion-action/gestion-action.component';
import { ModalComponent } from '../shared/modal/modal.component';
type DeleteAllTarget = 'collection' | 'decks' | 'combats' | 'purchases';
@Component({
  selector: 'app-gestion',
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    GestionActionComponent,
    ModalComponent,
    CardDisplayNamePipe,
  ],
  templateUrl: './gestion.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './gestion.component.scss',
})
export class GestionComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  @ViewChild('historySentinel')
  set historySentinel(el: ElementRef<HTMLElement> | undefined) {
    this.historyObserver?.disconnect();
    if (el) {
      this.historyObserver ??= new IntersectionObserver((entries) => {
        if (entries[0]?.isIntersecting) {
          this.loadMoreHistory();
        }
      });
      this.historyObserver.observe(el.nativeElement);
    }
  }
  // --- Collection ---
  exportingCollection = signal(false);
  importingCollection = signal(false);
  historyOpen = signal(false);
  historyItems = signal<CollectionHistoryEntry[]>([]);
  historyTotal = signal(0);
  historyPage = signal(1);
  historyLoading = signal(false);
  historyLoadingMore = signal(false);
  historySearch = signal('');
  private historyObserver?: IntersectionObserver;
  private readonly historySearchChange$ = new Subject<void>();
  private historySearchSubscription?: Subscription;
  // --- Decks ---
  importingDeck = signal(false);
  exportingAllDecks = signal(false);
  importingAllDecks = signal(false);
  // --- Combats ---
  exportingAllCombats = signal(false);
  importingAllCombats = signal(false);
  // --- Purchases ---
  exportingAllPurchases = signal(false);
  importingAllPurchases = signal(false);
  // --- Delete-all (shared across Collection/Decks/Combats/Purchases) ---
  deleteAllTarget = signal<DeleteAllTarget | null>(null);
  deleteAllStep = signal<0 | 1 | 2>(0);
  deleteAllCountLoading = signal(false);
  deleteAllCount = signal(0);
  deleteAllQty = signal(0);
  deletingAll = signal(false);
  constructor(
    private readonly catalogService: CatalogService,
    private readonly cardsService: CardsService,
    private readonly decksService: DecksService,
    private readonly combatsService: CombatsService,
    private readonly purchasesService: PurchasesService,
    private readonly deckListService: DeckListService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
  ) {}
  ngOnInit(): void {
    this.historySearchSubscription = this.historySearchChange$
      .pipe(debounceTime(300))
      .subscribe(() => {
        this.historyItems.set([]);
        this.historyTotal.set(0);
        this.loadHistoryPage(1);
      });
  }
  ngOnDestroy(): void {
    this.historyObserver?.disconnect();
    this.historySearchSubscription?.unsubscribe();
  }
  // ============ Collection ============
  exportCollection(): void {
    this.exportingCollection.set(true);
    this.cardsService.exportCollection().subscribe({
      next: (blob) => {
        this.exportingCollection.set(false);
        downloadBlob(blob, 'collection.json');
      },
      error: () => {
        this.exportingCollection.set(false);
        this.toastService.show(this.translate.instant('collection.exportFailed'), 'error');
      },
    });
  }
  async importCollection(event: Event): Promise<void> {
    try {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) {
        return;
      }
      this.importingCollection.set(true);
      this.cardsService.importCollection(await readJson(file)).subscribe({
        next: (result) => {
          this.importingCollection.set(false);
          this.toastService.show(
            this.translate.instant('collection.imported', {
              unique: result.imported,
              total: result.imported_quantity,
            }),
          );
          input.value = '';
        },
        error: (err) => {
          this.importingCollection.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('collection.importFailed'),
            'error',
          );
          input.value = '';
        },
      });
    } catch (error) {
      this.importingCollection.set(false);
      this.toastService.show(errorMessage(error), 'error');
    }
  }
  openHistory(): void {
    this.historyOpen.set(true);
    this.historySearch.set('');
    this.historyItems.set([]);
    this.historyPage.set(1);
    this.historyTotal.set(0);
    this.loadHistoryPage(1);
  }
  closeHistory(): void {
    this.historyOpen.set(false);
    this.historyObserver?.disconnect();
  }
  onHistorySearchChange(): void {
    this.historySearchChange$.next();
  }
  get hasMoreHistory(): boolean {
    return this.historyItems().length < this.historyTotal();
  }
  loadMoreHistory(): void {
    if (this.historyLoading() || this.historyLoadingMore() || !this.hasMoreHistory) {
      return;
    }
    this.loadHistoryPage(this.historyPage() + 1, true);
  }
  loadHistoryPage(page: number, append = false): void {
    if (append) {
      this.historyLoadingMore.set(true);
    } else {
      this.historyLoading.set(true);
    }
    this.cardsService.history(page, 50, this.historySearch().trim() || undefined).subscribe({
      next: (result) => {
        this.historyItems.set(append ? [...this.historyItems(), ...result.items] : result.items);
        this.historyTotal.set(result.total);
        this.historyPage.set(result.page);
        this.historyLoading.set(false);
        this.historyLoadingMore.set(false);
      },
      error: () => {
        this.historyLoading.set(false);
        this.historyLoadingMore.set(false);
        this.toastService.show(this.translate.instant('collection.loadHistoryFailed'), 'error');
      },
    });
  }
  imageUrlFor(imagePath: string): string {
    return this.catalogService.thumbnailUrl(imagePath);
  }
  historyActionLabel(entry: CollectionHistoryEntry): string {
    switch (entry.action) {
      case 'added':
        return 'Added';
      case 'increased':
        return 'Increased';
      case 'decreased':
        return 'Decreased';
      case 'removed':
        return 'Removed';
    }
  }
  historyQuantityLabel(entry: CollectionHistoryEntry): string {
    if (entry.action === 'added') {
      return `${entry.new_quantity}`;
    }
    if (entry.action === 'removed') {
      return `${entry.old_quantity} → 0`;
    }
    return `${entry.old_quantity} → ${entry.new_quantity}`;
  }
  // ============ Decks ============
  async importDeck(event: Event): Promise<void> {
    try {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) {
        return;
      }
      this.importingDeck.set(true);
      this.decksService.importDeck(await readJson(file)).subscribe({
        next: (deck) => {
          this.importingDeck.set(false);
          this.toastService.show(this.translate.instant('decks.importedDeck', { name: deck.name }));
          input.value = '';
        },
        error: (err) => {
          this.importingDeck.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('decks.importDeckFailed'),
            'error',
          );
          input.value = '';
        },
      });
    } catch (error) {
      this.importingDeck.set(false);
      this.toastService.show(errorMessage(error), 'error');
    }
  }
  exportAllDecks(): void {
    this.exportingAllDecks.set(true);
    this.decksService.exportAllDecks().subscribe({
      next: (blob) => {
        this.exportingAllDecks.set(false);
        downloadBlob(blob, 'decks.json');
      },
      error: (err) => {
        this.exportingAllDecks.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('decks.exportDecksFailed'),
          'error',
        );
      },
    });
  }
  async importAllDecks(event: Event): Promise<void> {
    try {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) {
        return;
      }
      this.importingAllDecks.set(true);
      this.decksService.importAllDecks(await readJson(file)).subscribe({
        next: (decks) => {
          this.importingAllDecks.set(false);
          this.toastService.show(
            this.translate.instant(
              decks.length === 1 ? 'decks.importedDecksCount' : 'decks.importedDecksCountPlural',
              {
                count: decks.length,
              },
            ),
          );
          input.value = '';
        },
        error: (err) => {
          this.importingAllDecks.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('decks.importAllFailed'),
            'error',
          );
          input.value = '';
        },
      });
    } catch (error) {
      this.importingAllDecks.set(false);
      this.toastService.show(errorMessage(error), 'error');
    }
  }
  // ============ Combats ============
  exportAllCombats(): void {
    this.exportingAllCombats.set(true);
    this.combatsService.exportAll().subscribe({
      next: (blob) => {
        this.exportingAllCombats.set(false);
        downloadBlob(blob, 'combats.json');
      },
      error: (err) => {
        this.exportingAllCombats.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('combats.exportAllFailed'),
          'error',
        );
      },
    });
  }
  async importAllCombats(event: Event): Promise<void> {
    try {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) {
        return;
      }
      this.importingAllCombats.set(true);
      this.combatsService.importAll(await readJson(file)).subscribe({
        next: (combats) => {
          this.importingAllCombats.set(false);
          this.toastService.show(
            this.translate.instant(
              combats.length === 1 ? 'combats.importedCombat' : 'combats.importedCombatPlural',
              {
                count: combats.length,
              },
            ),
          );
          input.value = '';
        },
        error: (err) => {
          this.importingAllCombats.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('combats.importAllFailed'),
            'error',
          );
          input.value = '';
        },
      });
    } catch (error) {
      this.importingAllCombats.set(false);
      this.toastService.show(errorMessage(error), 'error');
    }
  }
  // ============ Purchases ============
  exportAllPurchases(): void {
    this.exportingAllPurchases.set(true);
    this.purchasesService.exportAll().subscribe({
      next: (blob) => {
        this.exportingAllPurchases.set(false);
        downloadBlob(blob, 'purchases.json');
      },
      error: (err) => {
        this.exportingAllPurchases.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('purchases.exportAllFailed'),
          'error',
        );
      },
    });
  }
  async importAllPurchases(event: Event): Promise<void> {
    try {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) {
        return;
      }
      this.importingAllPurchases.set(true);
      this.purchasesService.importAll(await readJson(file)).subscribe({
        next: (purchases) => {
          this.importingAllPurchases.set(false);
          this.toastService.show(
            this.translate.instant(
              purchases.length === 1
                ? 'purchases.importedPurchase'
                : 'purchases.importedPurchasePlural',
              { count: purchases.length },
            ),
          );
          input.value = '';
        },
        error: (err) => {
          this.importingAllPurchases.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('purchases.importAllFailed'),
            'error',
          );
          input.value = '';
        },
      });
    } catch (error) {
      this.importingAllPurchases.set(false);
      this.toastService.show(errorMessage(error), 'error');
    }
  }
  // ============ Delete-all (shared) ============
  openDeleteAllConfirm(target: DeleteAllTarget): void {
    this.deleteAllTarget.set(target);
    this.deleteAllStep.set(1);
  }
  proceedToFinalDeleteAllConfirm(): void {
    const target = this.deleteAllTarget()!;
    if (!target) {
      return;
    }
    this.deleteAllCountLoading.set(true);
    const counted = (count: number, qty = 0) => {
      this.deleteAllCountLoading.set(false);
      this.deleteAllCount.set(count);
      this.deleteAllQty.set(qty);
      this.deleteAllStep.set(2);
    };
    switch (target) {
      case 'collection':
        this.cardsService.list().subscribe({
          next: (cards) =>
            counted(
              cards.length,
              cards.reduce((sum, c) => sum + c.quantity, 0),
            ),
          error: () => counted(0),
        });
        break;
      case 'decks':
        this.decksService.list().subscribe({
          next: (decks) => counted(decks.length),
          error: () => counted(0),
        });
        break;
      case 'combats':
        this.combatsService.list().subscribe({
          next: (combats) =>
            counted(
              combats.filter(
                (c) =>
                  this.auth.isAdmin() ||
                  c.player_a_id === this.auth.user()?.id ||
                  c.player_b_id === this.auth.user()?.id,
              ).length,
            ),
          error: () => counted(0),
        });
        break;
      case 'purchases':
        this.purchasesService.list().subscribe({
          next: (purchases) => counted(purchases.length),
          error: () => counted(0),
        });
        break;
    }
  }
  closeDeleteAllConfirm(): void {
    if (this.deletingAll()) {
      return;
    }
    this.deleteAllStep.set(0);
    this.deleteAllTarget.set(null);
  }
  get deleteAllTitleKey(): string {
    return this.deleteAllTarget()! === 'collection'
      ? 'collection.deleteAllConfirmTitle'
      : `${this.deleteAllTarget()!}.deleteAllTitle`;
  }
  get deleteAllConfirmBodyKey(): string {
    return this.deleteAllTarget()! === 'collection'
      ? 'collection.deleteAllConfirmBody'
      : `${this.deleteAllTarget()!}.deleteAllConfirmBody`;
  }
  get deleteAllFinalBodyKey(): string {
    return this.deleteAllTarget()! === 'collection'
      ? 'collection.deleteAllFinalBody'
      : `${this.deleteAllTarget()!}.deleteAllFinalBody`;
  }
  confirmDeleteAll(): void {
    const target = this.deleteAllTarget()!;
    if (!target) {
      return;
    }
    this.deletingAll.set(true);
    const done = () => {
      this.deletingAll.set(false);
      this.deleteAllStep.set(0);
      this.deleteAllTarget.set(null);
    };
    const fail = (err: unknown, key: string) => {
      this.deletingAll.set(false);
      this.toastService.show(
        (
          err as {
            error?: {
              detail?: string;
            };
          }
        )?.error?.detail ?? this.translate.instant(key),
        'error',
      );
    };
    switch (target) {
      case 'collection':
        this.cardsService.deleteAll().subscribe({
          next: (result) => {
            this.toastService.show(
              this.translate.instant('collection.deletedAll', {
                cards: result.deleted_cards,
                decks: result.deleted_decks,
              }),
            );
            this.deckListService.clear();
            done();
          },
          error: (err) => fail(err, 'collection.deleteFailed'),
        });
        break;
      case 'decks':
        this.decksService.deleteAll().subscribe({
          next: (result) => {
            this.toastService.show(
              this.translate.instant('decks.deletedDecksCount', { count: result.deleted_decks }),
            );
            done();
          },
          error: (err) => fail(err, 'decks.deleteAllFailed'),
        });
        break;
      case 'combats':
        this.combatsService.deleteAll().subscribe({
          next: (result) => {
            this.toastService.show(
              this.translate.instant('combats.deletedAllCombats', {
                count: result.deleted_combats,
              }),
            );
            done();
          },
          error: (err) => fail(err, 'combats.deleteAllFailed'),
        });
        break;
      case 'purchases':
        this.purchasesService.deleteAll().subscribe({
          next: (result) => {
            this.toastService.show(
              this.translate.instant('purchases.deletedAllPurchases', {
                count: result.deleted_purchases,
              }),
            );
            done();
          },
          error: (err) => fail(err, 'purchases.deleteAllFailed'),
        });
        break;
    }
  }
}
