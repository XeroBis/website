import { Icon } from '@shared';
import { signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CardSet } from '../../models/card.model';
import { Purchase, PurchaseSortOption } from '../../models/purchase.model';
import { CatalogService } from '../../services/catalog.service';
import { PurchasesService } from '../../services/purchases.service';
import { ToastService } from '../../services/toast.service';
import { ModalComponent } from '../shared/modal/modal.component';
import { toDateInputValue } from '../../util/date-input.util';
interface PurchaseFormState {
  product_name: string;
  price: number;
  quantity: number;
  purchased_at: string;
  source: string;
  description: string;
  sets: string[];
}
function emptyForm(): PurchaseFormState {
  return {
    product_name: '',
    price: 0,
    quantity: 1,
    purchased_at: toDateInputValue(new Date()),
    source: '',
    description: '',
    sets: [],
  };
}
const SORT_OPTIONS: PurchaseSortOption[] = [
  'date_desc',
  'date_asc',
  'name_asc',
  'name_desc',
  'price_desc',
  'price_asc',
  'source_asc',
  'source_desc',
];
const DEFAULT_SOURCES = ['Leboncoin', 'Vinted', 'Cardmarket', 'Ultra Pro', 'Other'];
@Component({
  selector: 'app-purchases',
  imports: [Icon, CommonModule, FormsModule, ModalComponent, TranslatePipe],
  templateUrl: './purchases.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './purchases.component.scss',
})
export class PurchasesComponent implements OnInit {
  purchases = signal<Purchase[]>([]);
  loading = signal(false);
  search = signal('');
  sort = signal<PurchaseSortOption>('date_desc');
  readonly sortOptions = SORT_OPTIONS;
  addOpen = signal(false);
  form = signal<PurchaseFormState>(emptyForm());
  submitting = signal(false);
  editOpen = signal(false);
  editPurchase = signal<Purchase | null>(null);
  editForm = signal<PurchaseFormState>(emptyForm());
  editSubmitting = signal(false);
  deletePurchase = signal<Purchase | null>(null);
  deleteLoading = signal(false);
  availableSets = signal<CardSet[]>([]);
  constructor(
    private readonly purchasesService: PurchasesService,
    private readonly catalogService: CatalogService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
  ) {}
  ngOnInit(): void {
    this.load();
    this.catalogService.listSets().subscribe({
      next: (sets) => this.availableSets.set(sets),
      error: () => {
        // Sets multi-select simply stays empty if this fails -- non-critical.
      },
    });
  }
  /** Suggested `source` values for the autocomplete: the defaults plus every
   * distinct value already used in this user's own purchase log. */
  get sourceSuggestions(): string[] {
    const used = this.purchases()
      .map((p) => p.source)
      .filter((s): s is string => !!s && !DEFAULT_SOURCES.includes(s));
    return [...DEFAULT_SOURCES, ...new Set(used)];
  }
  load(): void {
    this.loading.set(true);
    this.purchasesService.list().subscribe({
      next: (purchases) => {
        this.purchases.set(purchases);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toastService.show(this.translate.instant('purchases.loadFailed'), 'error');
      },
    });
  }
  get filteredPurchases(): Purchase[] {
    const term = this.search().trim().toLowerCase();
    const filtered = term
      ? this.purchases().filter((p) => p.product_name.toLowerCase().includes(term))
      : this.purchases();
    return [...filtered].sort((a, b) => {
      switch (this.sort()) {
        case 'date_asc':
          return new Date(a.purchased_at).getTime() - new Date(b.purchased_at).getTime();
        case 'name_asc':
          return a.product_name.localeCompare(b.product_name);
        case 'name_desc':
          return b.product_name.localeCompare(a.product_name);
        case 'price_asc':
          return Number(a.price) - Number(b.price);
        case 'price_desc':
          return Number(b.price) - Number(a.price);
        case 'source_asc':
          if (!a.source || !b.source) {
            return (a.source ? -1 : 0) - (b.source ? -1 : 0);
          }
          return a.source.localeCompare(b.source);
        case 'source_desc':
          if (!a.source || !b.source) {
            return (a.source ? -1 : 0) - (b.source ? -1 : 0);
          }
          return b.source.localeCompare(a.source);
        case 'date_desc':
        default:
          return new Date(b.purchased_at).getTime() - new Date(a.purchased_at).getTime();
      }
    });
  }
  get totalSpent(): number {
    return this.filteredPurchases.reduce((sum, p) => sum + Number(p.price), 0);
  }
  private validationError(form: PurchaseFormState): string | null {
    if (!form.product_name.trim()) {
      return this.translate.instant('purchases.missingProductName');
    }
    if (form.price < 0 || Number.isNaN(form.price)) {
      return this.translate.instant('purchases.invalidPrice');
    }
    if (form.quantity < 1 || Number.isNaN(form.quantity)) {
      return this.translate.instant('purchases.invalidQuantity');
    }
    if (!form.purchased_at) {
      return this.translate.instant('purchases.missingDate');
    }
    return null;
  }
  openAdd(): void {
    this.form.set(emptyForm());
    this.addOpen.set(true);
  }
  closeAdd(): void {
    if (!this.submitting()) {
      this.addOpen.set(false);
    }
  }
  submitAdd(): void {
    const error = this.validationError(this.form());
    if (error) {
      this.toastService.show(error, 'error');
      return;
    }
    this.submitting.set(true);
    this.purchasesService
      .create({
        product_name: this.form().product_name.trim(),
        price: this.form().price,
        quantity: this.form().quantity,
        purchased_at: new Date(this.form().purchased_at).toISOString(),
        source: this.form().source.trim() || null,
        description: this.form().description.trim() || null,
        sets: this.form().sets,
      })
      .subscribe({
        next: (purchase) => {
          this.submitting.set(false);
          this.purchases.set([purchase, ...this.purchases()]);
          this.addOpen.set(false);
          this.toastService.show(this.translate.instant('purchases.purchaseLogged'));
        },
        error: (err) => {
          this.submitting.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('purchases.logFailed'),
            'error',
          );
        },
      });
  }
  openEdit(purchase: Purchase): void {
    this.editPurchase.set(purchase);
    this.editForm.set({
      product_name: purchase.product_name,
      price: Number(purchase.price),
      quantity: purchase.quantity,
      purchased_at: toDateInputValue(new Date(purchase.purchased_at)),
      source: purchase.source ?? '',
      description: purchase.description ?? '',
      sets: [...purchase.sets],
    });
    this.editOpen.set(true);
  }
  closeEdit(): void {
    this.editOpen.set(false);
    this.editPurchase.set(null);
  }
  submitEdit(): void {
    if (!this.editPurchase()) {
      return;
    }
    const error = this.validationError(this.editForm());
    if (error) {
      this.toastService.show(error, 'error');
      return;
    }
    this.editSubmitting.set(true);
    this.purchasesService
      .update(this.editPurchase()!.id, {
        product_name: this.editForm().product_name.trim(),
        price: this.editForm().price,
        quantity: this.editForm().quantity,
        purchased_at: new Date(this.editForm().purchased_at).toISOString(),
        source: this.editForm().source.trim() || null,
        description: this.editForm().description.trim() || null,
        sets: this.editForm().sets,
      })
      .subscribe({
        next: (updated) => {
          this.editSubmitting.set(false);
          this.purchases.set(this.purchases().map((p) => (p.id === updated.id ? updated : p)));
          this.toastService.show(this.translate.instant('purchases.purchaseUpdated'));
          this.closeEdit();
        },
        error: (err) => {
          this.editSubmitting.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('purchases.updateFailed'),
            'error',
          );
        },
      });
  }
  openDeleteConfirm(purchase: Purchase): void {
    this.deletePurchase.set(purchase);
  }
  closeDeleteConfirm(): void {
    this.deletePurchase.set(null);
  }
  confirmDelete(): void {
    if (!this.deletePurchase()) {
      return;
    }
    const id = this.deletePurchase()!.id;
    this.deleteLoading.set(true);
    this.purchasesService.delete(id).subscribe({
      next: () => {
        this.deleteLoading.set(false);
        this.purchases.set(this.purchases().filter((p) => p.id !== id));
        this.toastService.show(this.translate.instant('purchases.purchaseDeleted'));
        this.deletePurchase.set(null);
      },
      error: (err) => {
        this.deleteLoading.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('purchases.deleteFailed'),
          'error',
        );
      },
    });
  }
}
