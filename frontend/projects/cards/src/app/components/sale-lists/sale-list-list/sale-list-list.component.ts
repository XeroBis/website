import { Icon } from '@shared';
import { signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { SaleList } from '../../../models/sale-list.model';
import { SaleListsService } from '../../../services/sale-lists.service';
import { ToastService } from '../../../services/toast.service';
import { ModalComponent } from '../../shared/modal/modal.component';

@Component({
  selector: 'app-sale-list-list',
  imports: [Icon, CommonModule, FormsModule, ModalComponent, TranslatePipe],
  templateUrl: './sale-list-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The purchase lists page's look, shared as is.
  styleUrl: '../../purchase-lists/purchase-list-list/purchase-list-list.component.scss',
})
export class SaleListListComponent implements OnInit {
  saleLists = signal<SaleList[]>([]);
  loading = signal(false);
  /** The new list's name, while the dialog is open. */
  createName = signal<string | null>(null);
  creating = signal(false);
  renameTarget = signal<SaleList | null>(null);
  renameValue = signal('');
  renaming = signal(false);
  deleteTarget = signal<SaleList | null>(null);
  deleting = signal(false);

  constructor(
    private readonly saleListsService: SaleListsService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.saleListsService.list().subscribe({
      next: (lists) => {
        this.saleLists.set(lists);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toastService.show(this.translate.instant('saleLists.loadFailed'), 'error');
      },
    });
  }

  openCreate(): void {
    this.createName.set('');
  }

  closeCreate(): void {
    if (!this.creating()) {
      this.createName.set(null);
    }
  }

  submitCreate(): void {
    const name = this.createName()?.trim();
    if (!name) {
      this.toastService.show(this.translate.instant('saleLists.missingName'), 'error');
      return;
    }
    this.creating.set(true);
    this.saleListsService.create(name).subscribe({
      next: (created) => {
        this.creating.set(false);
        this.createName.set(null);
        this.toastService.show(this.translate.instant('saleLists.created'));
        this.router.navigate(['/sale-lists', created.id]);
      },
      error: (err) => {
        this.creating.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('saleLists.createFailed'),
          'error',
        );
      },
    });
  }

  openList(saleList: SaleList): void {
    this.router.navigate(['/sale-lists', saleList.id]);
  }

  openRename(saleList: SaleList, event: Event): void {
    event.stopPropagation();
    this.renameTarget.set(saleList);
    this.renameValue.set(saleList.name);
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
    this.saleListsService.rename(target.id, this.renameValue().trim()).subscribe({
      next: (updated) => {
        this.renaming.set(false);
        this.saleLists.update((lists) =>
          lists.map((list) => (list.id === updated.id ? updated : list)),
        );
        this.toastService.show(this.translate.instant('saleLists.renamed'));
        this.renameTarget.set(null);
      },
      error: (err) => {
        this.renaming.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('saleLists.renameFailed'),
          'error',
        );
      },
    });
  }

  openDeleteConfirm(saleList: SaleList, event: Event): void {
    event.stopPropagation();
    this.deleteTarget.set(saleList);
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
    this.saleListsService.delete(target.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.saleLists.update((lists) => lists.filter((list) => list.id !== target.id));
        this.toastService.show(this.translate.instant('saleLists.deleted'));
        this.deleteTarget.set(null);
      },
      error: (err) => {
        this.deleting.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('saleLists.deleteFailed'),
          'error',
        );
      },
    });
  }
}
