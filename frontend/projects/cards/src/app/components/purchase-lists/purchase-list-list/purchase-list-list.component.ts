import { Icon } from '@shared';
import { computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CardmarketPreview, PurchaseList } from '../../../models/purchase-list.model';
import { PurchaseListsService } from '../../../services/purchase-lists.service';
import { ToastService } from '../../../services/toast.service';
import { toDateInputValue } from '../../../util/date-input.util';
import { ModalComponent } from '../../shared/modal/modal.component';

interface ImportForm {
  name: string;
  purchased_at: string;
  price: number;
}

@Component({
  selector: 'app-purchase-list-list',
  imports: [Icon, CommonModule, FormsModule, ModalComponent, TranslatePipe],
  templateUrl: './purchase-list-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './purchase-list-list.component.scss',
})
export class PurchaseListListComponent implements OnInit {
  purchaseLists = signal<PurchaseList[]>([]);
  loading = signal(false);
  /** The picked order page, read but not imported yet. */
  reading = signal(false);
  preview = signal<CardmarketPreview | null>(null);
  importForm = signal<ImportForm>({ name: '', purchased_at: '', price: 0 });
  importing = signal(false);
  unmatchedLines = computed(() => this.preview()?.lines.filter((line) => !line.matched) ?? []);
  matchedLineCount = computed(
    () => this.preview()?.lines.filter((line) => line.matched).length ?? 0,
  );
  renameTarget = signal<PurchaseList | null>(null);
  renameValue = signal('');
  renaming = signal(false);
  deleteTarget = signal<PurchaseList | null>(null);
  deleting = signal(false);
  private orderHtml = '';

  constructor(
    private readonly purchaseListsService: PurchaseListsService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.purchaseListsService.list().subscribe({
      next: (lists) => {
        this.purchaseLists.set(lists);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toastService.show(this.translate.instant('purchaseLists.loadFailed'), 'error');
      },
    });
  }

  /** Reads the picked file and asks the backend what it would import. */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    this.reading.set(true);
    file.text().then(
      (html) => {
        this.orderHtml = html;
        this.purchaseListsService.previewCardmarket(html).subscribe({
          next: (preview) => {
            this.reading.set(false);
            const today = toDateInputValue(new Date());
            this.importForm.set({
              name: `Cardmarket ${today}`,
              purchased_at: today,
              price: Number(preview.total_price),
            });
            this.preview.set(preview);
          },
          error: (err) => {
            this.reading.set(false);
            this.toastService.show(
              err?.error?.detail ?? this.translate.instant('purchaseLists.readFailed'),
              'error',
            );
          },
        });
      },
      () => {
        this.reading.set(false);
        this.toastService.show(this.translate.instant('purchaseLists.readFailed'), 'error');
      },
    );
  }

  closeImport(): void {
    if (!this.importing()) {
      this.preview.set(null);
      this.orderHtml = '';
    }
  }

  updateImportForm(patch: Partial<ImportForm>): void {
    this.importForm.update((form) => ({ ...form, ...patch }));
  }

  submitImport(): void {
    const form = this.importForm();
    if (!form.name.trim()) {
      this.toastService.show(this.translate.instant('purchaseLists.missingName'), 'error');
      return;
    }
    this.importing.set(true);
    this.purchaseListsService
      .importCardmarket({
        html: this.orderHtml,
        name: form.name.trim(),
        purchased_at: form.purchased_at,
        price: Number(form.price || 0).toFixed(2),
      })
      .subscribe({
        next: (result) => {
          this.importing.set(false);
          this.preview.set(null);
          this.orderHtml = '';
          this.toastService.show(this.translate.instant('purchaseLists.imported'));
          if (result.unmatched.length > 0) {
            this.toastService.show(
              this.translate.instant('purchaseLists.linesSkipped', {
                count: result.unmatched.length,
              }),
              'error',
            );
          }
          this.router.navigate(['/purchase-lists', result.purchase_list.id]);
        },
        error: (err) => {
          this.importing.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('purchaseLists.importFailed'),
            'error',
          );
        },
      });
  }

  openList(purchaseList: PurchaseList): void {
    this.router.navigate(['/purchase-lists', purchaseList.id]);
  }

  openRename(purchaseList: PurchaseList, event: Event): void {
    event.stopPropagation();
    this.renameTarget.set(purchaseList);
    this.renameValue.set(purchaseList.name);
  }

  closeRename(): void {
    if (!this.renaming()) {
      this.renameTarget.set(null);
    }
  }

  submitRename(): void {
    const target = this.renameTarget();
    if (!target || !this.renameValue().trim()) {
      return;
    }
    this.renaming.set(true);
    this.purchaseListsService.rename(target.id, this.renameValue().trim()).subscribe({
      next: (updated) => {
        this.renaming.set(false);
        this.purchaseLists.update((lists) =>
          lists.map((list) => (list.id === updated.id ? updated : list)),
        );
        this.toastService.show(this.translate.instant('purchaseLists.renamed'));
        this.renameTarget.set(null);
      },
      error: (err) => {
        this.renaming.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('purchaseLists.renameFailed'),
          'error',
        );
      },
    });
  }

  openDeleteConfirm(purchaseList: PurchaseList, event: Event): void {
    event.stopPropagation();
    this.deleteTarget.set(purchaseList);
  }

  closeDeleteConfirm(): void {
    if (!this.deleting()) {
      this.deleteTarget.set(null);
    }
  }

  confirmDelete(): void {
    const target = this.deleteTarget();
    if (!target) {
      return;
    }
    this.deleting.set(true);
    this.purchaseListsService.delete(target.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.purchaseLists.update((lists) => lists.filter((list) => list.id !== target.id));
        this.toastService.show(this.translate.instant('purchaseLists.deleted'));
        this.deleteTarget.set(null);
      },
      error: (err) => {
        this.deleting.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('purchaseLists.deleteFailed'),
          'error',
        );
      },
    });
  }
}
