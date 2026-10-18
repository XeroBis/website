import { Icon } from '@shared';
import { signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ShoppingList } from '../../../models/shopping-list.model';
import { ShoppingListService } from '../../../services/shopping-list.service';
import { ToastService } from '../../../services/toast.service';
import { ModalComponent } from '../../shared/modal/modal.component';
@Component({
  selector: 'app-shopping-list-list',
  imports: [Icon, CommonModule, FormsModule, ModalComponent, TranslatePipe],
  templateUrl: './shopping-list-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './shopping-list-list.component.scss',
})
export class ShoppingListListComponent implements OnInit {
  shoppingLists = signal<ShoppingList[]>([]);
  loading = signal(false);
  createOpen = signal(false);
  createName = signal('');
  createDecklistText = signal('');
  creating = signal(false);
  renameTarget = signal<ShoppingList | null>(null);
  renameValue = signal('');
  renaming = signal(false);
  deleteTarget = signal<ShoppingList | null>(null);
  deleting = signal(false);
  constructor(
    private readonly shoppingListService: ShoppingListService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
    private readonly router: Router,
  ) {}
  ngOnInit(): void {
    this.load();
  }
  load(): void {
    this.loading.set(true);
    this.shoppingListService.list().subscribe({
      next: (lists) => {
        this.shoppingLists.set(lists);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toastService.show(this.translate.instant('shoppingLists.loadFailed'), 'error');
      },
    });
  }
  openCreate(): void {
    this.createName.set('');
    this.createDecklistText.set('');
    this.createOpen.set(true);
  }
  closeCreate(): void {
    if (!this.creating()) {
      this.createOpen.set(false);
    }
  }
  submitCreate(): void {
    if (!this.createName().trim()) {
      this.toastService.show(this.translate.instant('shoppingLists.missingName'), 'error');
      return;
    }
    this.creating.set(true);
    this.shoppingListService.create(this.createName().trim(), this.createDecklistText()).subscribe({
      next: (result) => {
        this.creating.set(false);
        this.createOpen.set(false);
        this.shoppingLists.set([result.shopping_list, ...this.shoppingLists()]);
        this.toastService.show(this.translate.instant('shoppingLists.created'));
        if (result.lines_skipped > 0) {
          this.toastService.show(
            this.translate.instant('shoppingLists.linesSkipped', { count: result.lines_skipped }),
            'error',
          );
        }
        this.router.navigate(['/shopping-lists', result.shopping_list.id]);
      },
      error: (err) => {
        this.creating.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('shoppingLists.createFailed'),
          'error',
        );
      },
    });
  }
  openList(shoppingList: ShoppingList): void {
    this.router.navigate(['/shopping-lists', shoppingList.id]);
  }
  openRename(shoppingList: ShoppingList, event: Event): void {
    event.stopPropagation();
    this.renameTarget.set(shoppingList);
    this.renameValue.set(shoppingList.name);
  }
  closeRename(): void {
    if (!this.renaming()) {
      this.renameTarget.set(null);
    }
  }
  submitRename(): void {
    if (!this.renameTarget()! || !this.renameValue().trim()) {
      return;
    }
    this.renaming.set(true);
    this.shoppingListService.rename(this.renameTarget()!.id, this.renameValue().trim()).subscribe({
      next: (updated) => {
        this.renaming.set(false);
        this.shoppingLists.set(
          this.shoppingLists().map((sl) => (sl.id === updated.id ? updated : sl)),
        );
        this.toastService.show(this.translate.instant('shoppingLists.renamed'));
        this.renameTarget.set(null);
      },
      error: (err) => {
        this.renaming.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('shoppingLists.renameFailed'),
          'error',
        );
      },
    });
  }
  openDeleteConfirm(shoppingList: ShoppingList, event: Event): void {
    event.stopPropagation();
    this.deleteTarget.set(shoppingList);
  }
  closeDeleteConfirm(): void {
    if (!this.deleting()) {
      this.deleteTarget.set(null);
    }
  }
  confirmDelete(): void {
    if (!this.deleteTarget()) {
      return;
    }
    const id = this.deleteTarget()!.id;
    this.deleting.set(true);
    this.shoppingListService.delete(id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.shoppingLists.set(this.shoppingLists().filter((sl) => sl.id !== id));
        this.toastService.show(this.translate.instant('shoppingLists.deleted'));
        this.deleteTarget.set(null);
      },
      error: (err) => {
        this.deleting.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('shoppingLists.deleteFailed'),
          'error',
        );
      },
    });
  }
}
