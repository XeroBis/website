import { Icon } from '@shared';
import { signal } from '@angular/core';
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DeckExportTextFormat, DraftExportMode, DraftPickerItem } from '../../../models/deck.model';
import { DraftExportService } from '../../../services/draft-export.service';
import { ToastService } from '../../../services/toast.service';
import { ModalComponent } from '../../shared/modal/modal.component';
/** "Combine drafts" export -- lets the user pick several Deck Upgrade
 * Drafts across any of their Normal decks and export one shopping list
 * where a card wanted by more than one draft is only checked against
 * owned/available copies once (pooled demand), instead of each draft
 * independently claiming the same owned copy -- see
 * documentation/features.md's "Combined draft export". Launched from a
 * button in the deck list page's top bar, next to "New deck". */
@Component({
  selector: 'app-multi-draft-export',
  imports: [Icon, FormsModule, ModalComponent, TranslatePipe],
  templateUrl: './multi-draft-export.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './multi-draft-export.component.scss',
})
export class MultiDraftExportComponent {
  pickerOpen = signal(false);
  pickerLoading = signal(false);
  drafts = signal<DraftPickerItem[]>([]);
  selectedIds = signal(new Set<number>());
  exportOpen = signal(false);
  exportMode = signal<DraftExportMode>('missing');
  exportIncludeSets = signal(true);
  exportLanguage = signal<'en' | 'fr'>('en');
  exporting = signal(false);
  constructor(
    private readonly draftExportService: DraftExportService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
  ) {}
  openPicker(): void {
    this.pickerOpen.set(true);
    this.selectedIds.set(new Set());
    this.loadDrafts();
  }
  closePicker(): void {
    this.pickerOpen.set(false);
  }
  private loadDrafts(): void {
    this.pickerLoading.set(true);
    this.draftExportService.listAll().subscribe({
      next: (drafts) => {
        this.drafts.set(drafts);
        this.pickerLoading.set(false);
      },
      error: () => {
        this.pickerLoading.set(false);
        this.toastService.show(
          this.translate.instant('decks.multiDraftExport.loadFailed'),
          'error',
        );
      },
    });
  }
  toggleSelected(draft: DraftPickerItem): void {
    if (this.selectedIds().has(draft.id)) {
      this.selectedIds.update((value) => {
        const next = new Set(value);
        next.delete(draft.id);
        return next;
      });
    } else {
      this.selectedIds.update((value) => {
        const next = new Set(value);
        next.add(draft.id);
        return next;
      });
    }
  }
  isSelected(draft: DraftPickerItem): boolean {
    return this.selectedIds().has(draft.id);
  }
  get selectedCount(): number {
    return this.selectedIds().size;
  }
  goToExportStep(): void {
    if (this.selectedCount === 0) {
      return;
    }
    this.exportMode.set('missing');
    this.exportIncludeSets.set(true);
    this.exportLanguage.set('en');
    this.pickerOpen.set(false);
    this.exportOpen.set(true);
  }
  backToPicker(): void {
    if (this.exporting()) {
      return;
    }
    this.exportOpen.set(false);
    this.pickerOpen.set(true);
  }
  closeExport(): void {
    if (!this.exporting()) {
      this.exportOpen.set(false);
    }
  }
  doExport(format: DeckExportTextFormat): void {
    if (this.selectedCount === 0 || this.exporting()) {
      return;
    }
    this.exporting.set(true);
    this.draftExportService
      .exportText(
        { draft_ids: Array.from(this.selectedIds()) },
        format,
        this.exportMode(),
        this.exportIncludeSets(),
        this.exportLanguage(),
      )
      .subscribe({
        next: (text) => {
          this.exporting.set(false);
          this.exportOpen.set(false);
          this.copyToClipboard(text);
        },
        error: () => {
          this.exporting.set(false);
          this.toastService.show(this.translate.instant('decks.exportDeckFailed'), 'error');
        },
      });
  }
  private copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text).then(
      () => this.toastService.show(this.translate.instant('decks.exportCopied')),
      () => this.toastService.show(this.translate.instant('decks.exportCopyFailed'), 'error'),
    );
  }
}
