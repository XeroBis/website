import { computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, switchMap } from 'rxjs/operators';
import { Icon, IconName } from '@shared';
import {
  CardCatalogEntry,
  VARIANT_BADGES,
  VARIANT_LABELS,
  VariantType,
} from '../../../models/card.model';
import { PurchaseListCard, PurchaseListDetail } from '../../../models/purchase-list.model';
import { CatalogService } from '../../../services/catalog.service';
import { PurchaseListsService } from '../../../services/purchase-lists.service';
import { ToastService } from '../../../services/toast.service';
import { rarityCategory, sortRarityCategories } from '../../../util/rarity-category.util';
import { rarityIconUrl } from '../../../util/rarity-icons.util';
import { togglePrintSelection } from '../../../util/variant-display.util';
import { variantIconUrl } from '../../../util/variant-icons.util';
import { ModalComponent } from '../../shared/modal/modal.component';

type ListView = 'grid' | 'list' | 'sets';
const VIEW_STORAGE_KEY = 'purchaseListView';

function readStoredView(): ListView {
  try {
    const view = localStorage.getItem(VIEW_STORAGE_KEY);
    return view === 'list' || view === 'sets' ? view : 'grid';
  } catch {
    return 'grid';
  }
}

/** One catalog card in the grid views, with every print it's bought in. */
interface PurchaseTile {
  catalog_id: number;
  name: string;
  set_code: string;
  set_name: string;
  card_number: string;
  image_path: string;
  prints: { variant_type: VariantType; quantity: number }[];
}

@Component({
  selector: 'app-purchase-list-detail',
  imports: [Icon, CommonModule, FormsModule, RouterModule, ModalComponent, TranslatePipe],
  templateUrl: './purchase-list-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './purchase-list-detail.component.scss',
})
export class PurchaseListDetailComponent implements OnInit, OnDestroy {
  purchaseList = signal<PurchaseListDetail | null>(null);
  loading = signal(false);
  /** Lines with a change in flight, so their controls wait for it. */
  pendingRows = signal(new Set<number>());
  editable = computed(() => !!this.purchaseList() && !this.purchaseList()!.received_at);
  search = signal('');
  /** Icon filters, as on the set pages: an empty selection means all. */
  setFilter = signal(new Set<string>());
  printFilter = signal<VariantType[]>([]);
  rarityFilter = signal(new Set<string>());
  /** Set symbols by set code, for the set filter. */
  setSymbols = signal(new Map<string, string>());
  /** Grid (one tile per card), list (one editable row per print) or grid by
   * set. Remembered per browser. */
  view = signal<ListView>(readStoredView());
  readonly viewOptions: { view: ListView; icon: IconName; label: string }[] = [
    { view: 'grid', icon: 'grid', label: 'purchaseLists.detail.viewGrid' },
    { view: 'list', icon: 'list', label: 'purchaseLists.detail.viewList' },
    { view: 'sets', icon: 'layers', label: 'purchaseLists.detail.viewSets' },
  ];
  setOptions = computed(() => {
    const sets = new Map<string, string>();
    for (const card of this.purchaseList()?.cards ?? []) {
      sets.set(card.set_code, card.set_name);
    }
    return [...sets].map(([set_code, set_name]) => ({ set_code, set_name }));
  });
  printOptions = computed(() => [
    ...new Set((this.purchaseList()?.cards ?? []).map((card) => card.variant_type)),
  ]);
  rarityOptions = computed(() =>
    sortRarityCategories(
      new Set(
        (this.purchaseList()?.cards ?? []).flatMap((card) =>
          card.rarity ? [rarityCategory(card.rarity)] : [],
        ),
      ),
    ),
  );
  filteredCards = computed(() => {
    const term = this.search().trim().toLowerCase();
    return (this.purchaseList()?.cards ?? []).filter(
      (card) =>
        (!term || card.name.toLowerCase().includes(term)) &&
        (this.setFilter().size === 0 || this.setFilter().has(card.set_code)) &&
        (this.printFilter().length === 0 || this.printFilter().includes(card.variant_type)) &&
        (this.rarityFilter().size === 0 ||
          (!!card.rarity && this.rarityFilter().has(rarityCategory(card.rarity)))),
    );
  });
  /** filteredCards grouped by card (a card bought as standard and reverse is
   * one tile), in the list's set-then-number order. */
  tiles = computed(() => {
    const tiles = new Map<number, PurchaseTile>();
    for (const card of this.filteredCards()) {
      let tile = tiles.get(card.catalog_id);
      if (!tile) {
        tile = {
          catalog_id: card.catalog_id,
          name: card.name,
          set_code: card.set_code,
          set_name: card.set_name,
          card_number: card.card_number,
          image_path: card.image_path,
          prints: [],
        };
        tiles.set(card.catalog_id, tile);
      }
      tile.prints.push({ variant_type: card.variant_type, quantity: card.quantity });
    }
    // Prints in the catalog's display order (`variants` comes sorted).
    const order = new Map(
      this.filteredCards().map((card) => [card.catalog_id, card.variants] as const),
    );
    for (const tile of tiles.values()) {
      const variants = order.get(tile.catalog_id) ?? [];
      tile.prints.sort(
        (a, b) => variants.indexOf(a.variant_type) - variants.indexOf(b.variant_type),
      );
    }
    return [...tiles.values()];
  });
  setGroups = computed(() => {
    const groups = new Map<
      string,
      { set_code: string; set_name: string; tiles: PurchaseTile[]; quantity: number }
    >();
    for (const tile of this.tiles()) {
      let group = groups.get(tile.set_code);
      if (!group) {
        group = { set_code: tile.set_code, set_name: tile.set_name, tiles: [], quantity: 0 };
        groups.set(tile.set_code, group);
      }
      group.tiles.push(tile);
      group.quantity += tile.prints.reduce((sum, print) => sum + print.quantity, 0);
    }
    return [...groups.values()];
  });
  readonly variantLabels = VARIANT_LABELS;
  readonly variantIcon = variantIconUrl;
  readonly rarityIcon = rarityIconUrl;

  receiveOpen = signal(false);
  receiving = signal(false);
  removeTarget = signal<PurchaseListCard | null>(null);
  removing = signal(false);

  addOpen = signal(false);
  addSearch = signal('');
  addResults = signal<CardCatalogEntry[]>([]);
  addSearching = signal(false);
  addPicked = signal<CardCatalogEntry | null>(null);
  addVariant = signal<VariantType>('standard');
  addQuantity = signal(1);
  adding = signal(false);
  private readonly addSearch$ = new Subject<string>();
  private addSearchSubscription?: Subscription;
  private listId!: number;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly purchaseListsService: PurchaseListsService,
    private readonly catalogService: CatalogService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
  ) {}

  ngOnInit(): void {
    this.listId = Number(this.route.snapshot.paramMap.get('id'));
    this.load();
    this.catalogService.listSets().subscribe((sets) => {
      this.setSymbols.set(
        new Map(
          sets.flatMap((set) =>
            set.symbol_path
              ? [[set.set_code, this.catalogService.imageUrl(set.symbol_path)] as const]
              : [],
          ),
        ),
      );
    });
    this.addSearchSubscription = this.addSearch$
      .pipe(
        debounceTime(250),
        switchMap((term) => {
          this.addSearching.set(true);
          return this.catalogService.browse({ search: term, pageSize: 20 });
        }),
      )
      .subscribe({
        next: (page) => {
          this.addSearching.set(false);
          this.addResults.set(page.items);
        },
        error: () => this.addSearching.set(false),
      });
  }

  ngOnDestroy(): void {
    this.addSearchSubscription?.unsubscribe();
  }

  load(): void {
    this.loading.set(true);
    this.purchaseListsService.get(this.listId).subscribe({
      next: (detail) => {
        this.purchaseList.set(detail);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toastService.show(this.translate.instant('purchaseLists.detail.loadFailed'), 'error');
        this.router.navigate(['/purchase-lists']);
      },
    });
  }

  clearRarities(): void {
    this.rarityFilter.set(new Set());
  }

  toggleRarity(rarity: string): void {
    this.rarityFilter.update((selected) => {
      const next = new Set(selected);
      if (next.has(rarity)) {
        next.delete(rarity);
      } else {
        next.add(rarity);
      }
      return next;
    });
  }

  togglePrint(variant: VariantType | 'all'): void {
    this.printFilter.update((selected) => togglePrintSelection(selected, variant));
  }

  /** A rarity with no icon yet shows its name instead. */
  onIconError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    img.nextElementSibling?.classList.add('visible');
  }

  clearSets(): void {
    this.setFilter.set(new Set());
  }

  toggleSet(setCode: string): void {
    this.setFilter.update((selected) => {
      const next = new Set(selected);
      if (next.has(setCode)) {
        next.delete(setCode);
      } else {
        next.add(setCode);
      }
      return next;
    });
  }

  setView(view: ListView): void {
    this.view.set(view);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // Storage unavailable -- the choice just won't persist.
    }
  }

  /** "×2" for standard, "R×1" for reverse, the print's badge otherwise. */
  printBadge(variant: VariantType): string {
    return VARIANT_BADGES[variant] ?? '';
  }

  imageUrl(imagePath: string): string {
    return this.catalogService.thumbnailUrl(imagePath);
  }

  // ── lines ──────────────────────────────────────────────────────────────────

  changeQuantity(card: PurchaseListCard, delta: number): void {
    const quantity = card.quantity + delta;
    if (quantity >= 1) {
      this.saveLine(card, card.variant_type, quantity);
    }
  }

  changeVariant(card: PurchaseListCard, variant: VariantType): void {
    if (variant !== card.variant_type) {
      this.saveLine(card, variant, card.quantity);
    }
  }

  private saveLine(card: PurchaseListCard, variant: VariantType, quantity: number): void {
    this.setPending(card.id, true);
    this.purchaseListsService.updateCard(this.listId, card.id, variant, quantity).subscribe({
      next: (detail) => {
        this.setPending(card.id, false);
        this.purchaseList.set(detail);
      },
      error: (err) => {
        this.setPending(card.id, false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('purchaseLists.detail.updateFailed'),
          'error',
        );
      },
    });
  }

  private setPending(rowId: number, pending: boolean): void {
    this.pendingRows.update((rows) => {
      const next = new Set(rows);
      if (pending) {
        next.add(rowId);
      } else {
        next.delete(rowId);
      }
      return next;
    });
  }

  openRemoveConfirm(card: PurchaseListCard): void {
    this.removeTarget.set(card);
  }

  closeRemoveConfirm(): void {
    if (!this.removing()) {
      this.removeTarget.set(null);
    }
  }

  confirmRemove(): void {
    const target = this.removeTarget();
    if (!target) {
      return;
    }
    this.removing.set(true);
    this.purchaseListsService.removeCard(this.listId, target.id).subscribe({
      next: () => {
        this.removing.set(false);
        this.removeTarget.set(null);
        this.toastService.show(this.translate.instant('purchaseLists.detail.removed'));
        this.load();
      },
      error: (err) => {
        this.removing.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('purchaseLists.detail.removeFailed'),
          'error',
        );
      },
    });
  }

  // ── add by hand ────────────────────────────────────────────────────────────

  openAdd(): void {
    this.addSearch.set('');
    this.addResults.set([]);
    this.addPicked.set(null);
    this.addQuantity.set(1);
    this.addOpen.set(true);
  }

  closeAdd(): void {
    if (!this.adding()) {
      this.addOpen.set(false);
    }
  }

  onAddSearchChange(term: string): void {
    this.addSearch.set(term);
    if (term.trim().length >= 2) {
      this.addSearch$.next(term.trim());
    } else {
      this.addResults.set([]);
    }
  }

  pickCard(card: CardCatalogEntry): void {
    this.addPicked.set(card);
    this.addVariant.set('standard');
  }

  submitAdd(): void {
    const card = this.addPicked();
    if (!card) {
      return;
    }
    this.adding.set(true);
    this.purchaseListsService
      .addCard(this.listId, card.id, this.addVariant(), Math.max(1, this.addQuantity()))
      .subscribe({
        next: (detail) => {
          this.adding.set(false);
          this.purchaseList.set(detail);
          this.addOpen.set(false);
          this.toastService.show(this.translate.instant('purchaseLists.detail.added'));
        },
        error: (err) => {
          this.adding.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('purchaseLists.detail.addFailed'),
            'error',
          );
        },
      });
  }

  // ── receive ────────────────────────────────────────────────────────────────

  closeReceive(): void {
    if (!this.receiving()) {
      this.receiveOpen.set(false);
    }
  }

  confirmReceive(): void {
    this.receiving.set(true);
    this.purchaseListsService.receive(this.listId).subscribe({
      next: (detail) => {
        this.receiving.set(false);
        this.receiveOpen.set(false);
        this.purchaseList.set(detail);
        this.toastService.show(this.translate.instant('purchaseLists.detail.receivedToast'));
      },
      error: (err) => {
        this.receiving.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('purchaseLists.detail.receiveFailed'),
          'error',
        );
      },
    });
  }
}
