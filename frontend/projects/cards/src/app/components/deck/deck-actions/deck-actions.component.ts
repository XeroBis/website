import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Icon } from '@shared';
import { signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DestroyRef,
  inject,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { DecklistConvertEntry } from '../../../models/card.model';
import {
  Deck,
  DeckCard,
  DeckDetail,
  DeckExportFormat,
  DeckExportMode,
  DeckHistoryEntry,
  DeckUpdate,
} from '../../../models/deck.model';
import { CatalogService } from '../../../services/catalog.service';
import { ConvertService } from '../../../services/convert.service';
import { DecksService } from '../../../services/decks.service';
import { ToastService } from '../../../services/toast.service';
import { downloadBlob } from '@shared';
import { posterSlots } from '../../../util/deck-visuals';
import { CardDisplayNamePipe } from '../../../util/card-display-name.pipe';
import { DecklistPreviewComponent } from '../../shared/decklist-preview/decklist-preview.component';
import { ModalComponent } from '../../shared/modal/modal.component';
@Component({
  selector: 'app-deck-actions',
  imports: [
    Icon,
    CommonModule,
    FormsModule,
    ModalComponent,
    DecklistPreviewComponent,
    TranslatePipe,
    CardDisplayNamePipe,
  ],
  templateUrl: './deck-actions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './deck-actions.component.scss',
})
export class DeckActionsComponent {
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
  @Input({ required: true })
  deck!: Deck;
  @Output()
  renamed = new EventEmitter<Deck>();
  @Output()
  copied = new EventEmitter<Deck>();
  @Output()
  deleted = new EventEmitter<number>();
  @Output()
  pasted = new EventEmitter<DeckDetail>();
  exporting = signal(false);
  exportOpen = signal(false);
  exportMode = signal<DeckExportMode>('full');
  menuOpen = signal(false);
  copyOpen = signal(false);
  copyName = signal('');
  copyLoading = signal(false);
  renameOpen = signal(false);
  renameName = signal('');
  renameLoading = signal(false);
  /** Up to 3 slots, `null` for an unpicked one -- edited alongside the name
   * in the same "Rename deck" modal, see documentation/features.md's
   * "Poster cards". */
  posterSelection = signal<(DeckCard | null)[]>([null, null, null]);
  posterCardChoices = signal<DeckCard[]>([]);
  posterCardChoicesLoading = signal(false);
  posterPickerSlot = signal<number | null>(null);
  deleteConfirmOpen = signal(false);
  deleteLoading = signal(false);
  historyOpen = signal(false);
  historyItems = signal<DeckHistoryEntry[]>([]);
  historyTotal = signal(0);
  historyPage = signal(1);
  historyLoading = signal(false);
  historyLoadingMore = signal(false);
  private historyObserver?: IntersectionObserver;
  private readonly destroyRef = inject(DestroyRef);
  pasteOpen = signal(false);
  pasteText = signal('');
  pastePreviewEntries = signal<DecklistConvertEntry[]>([]);
  pastePreviewLoading = signal(false);
  pasteSubmitting = signal(false);
  private readonly pasteTextChanged = new Subject<string>();
  constructor(
    private readonly decksService: DecksService,
    private readonly catalogService: CatalogService,
    private readonly convertService: ConvertService,
    private readonly toastService: ToastService,
    private readonly elementRef: ElementRef<HTMLElement>,
    private readonly translate: TranslateService,
  ) {
    this.destroyRef.onDestroy(() => this.historyObserver?.disconnect());
    this.pasteTextChanged
      .pipe(debounceTime(400), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((text) => {
        this.previewPaste(text);
      });
  }
  toggleMenu(): void {
    this.menuOpen.set(!this.menuOpen());
  }
  closeMenu(): void {
    this.menuOpen.set(false);
  }
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.menuOpen() && !this.elementRef.nativeElement.contains(event.target as Node)) {
      this.menuOpen.set(false);
    }
  }
  /** Opens the export modal: a JSON/TCGPlayer/Cardmarket format picker,
   * plus -- for a phantom deck only -- the full/missing/not-available
   * want-list mode picker, since its export can be filtered down to just
   * what's missing. Normal decks always use "full" (their only meaningful
   * mode -- everything they hold is already fully owned). */
  exportDeck(): void {
    this.exportMode.set('full');
    this.exportOpen.set(true);
  }
  closeExport(): void {
    if (!this.exporting()) {
      this.exportOpen.set(false);
    }
  }
  /** JSON downloads a file; TCGPlayer/Cardmarket fetch the same
   * Decklist-Converter-formatted text the backend renders and copy it to
   * the clipboard instead. */
  doExport(format: DeckExportFormat): void {
    this.exporting.set(true);
    if (format === 'json') {
      this.decksService.exportDeck(this.deck.id, this.exportMode()).subscribe({
        next: (data) => {
          this.exporting.set(false);
          this.exportOpen.set(false);
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          downloadBlob(blob, `${this.deck.name}.json`);
        },
        error: () => {
          this.exporting.set(false);
          this.toastService.show(this.translate.instant('decks.exportDeckFailed'), 'error');
        },
      });
      return;
    }
    this.decksService.exportDeckText(this.deck.id, format, this.exportMode()).subscribe({
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
  openCopy(): void {
    this.copyName.set(this.translate.instant('decks.copyOfName', { name: this.deck.name }));
    this.copyOpen.set(true);
  }
  closeCopy(): void {
    this.copyOpen.set(false);
  }
  submitCopy(): void {
    if (!this.copyName().trim()) {
      return;
    }
    this.copyLoading.set(true);
    this.decksService.copy(this.deck.id, { name: this.copyName().trim() }).subscribe({
      next: (deck) => {
        this.copyLoading.set(false);
        this.copyOpen.set(false);
        this.toastService.show(this.translate.instant('decks.copiedDeck', { name: deck.name }));
        this.copied.emit(deck);
      },
      error: (err) => {
        this.copyLoading.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('decks.copyDeckFailed'),
          'error',
        );
      },
    });
  }
  openPaste(): void {
    this.pasteText.set('');
    this.pastePreviewEntries.set([]);
    this.pasteOpen.set(true);
  }
  closePaste(): void {
    this.pasteOpen.set(false);
  }
  onPasteTextChange(): void {
    this.pasteTextChanged.next(this.pasteText());
  }
  private previewPaste(text: string): void {
    if (!text.trim()) {
      this.pastePreviewEntries.set([]);
      this.pastePreviewLoading.set(false);
      return;
    }
    this.pastePreviewLoading.set(true);
    this.convertService.convertDecklist(text).subscribe({
      next: (res) => {
        this.pastePreviewEntries.set(res.entries);
        this.pastePreviewLoading.set(false);
      },
      error: () => {
        this.pastePreviewLoading.set(false);
      },
    });
  }
  submitPaste(): void {
    if (!this.pasteText().trim()) {
      return;
    }
    this.pasteSubmitting.set(true);
    this.decksService.addFromPaste(this.deck.id, { decklist_text: this.pasteText() }).subscribe({
      next: (deck) => {
        this.pasteSubmitting.set(false);
        this.pasteOpen.set(false);
        this.pasteText.set('');
        this.pastePreviewEntries.set([]);
        this.toastService.show(this.translate.instant('decks.pasteAddedToDeck'));
        this.pasted.emit(deck);
      },
      error: (err) => {
        this.pasteSubmitting.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('decks.pasteAddFailed'),
          'error',
        );
      },
    });
  }
  openRename(): void {
    this.renameName.set(this.deck.name);
    this.posterSelection.set(posterSlots(this.deck.poster_cards));
    this.posterPickerSlot.set(null);
    this.renameOpen.set(true);
    this.posterCardChoicesLoading.set(true);
    this.decksService.get(this.deck.id).subscribe({
      next: (detail) => {
        this.posterCardChoices.set(detail.cards);
        this.posterCardChoicesLoading.set(false);
      },
      error: () => {
        this.posterCardChoicesLoading.set(false);
      },
    });
  }
  closeRename(): void {
    this.renameOpen.set(false);
    this.posterPickerSlot.set(null);
  }
  thumbnailUrl(imagePath: string): string {
    return this.catalogService.thumbnailUrl(imagePath);
  }
  /** Every deck card not already occupying a different poster slot -- so
   * the same card can't be picked twice, but re-opening the picker on an
   * already-filled slot still offers to swap it for another. */
  posterChoicesFor(slot: number): DeckCard[] {
    const takenElsewhere = new Set(
      this.posterSelection()
        .filter((_, i) => i !== slot)
        .map((c) => c?.id),
    );
    return this.posterCardChoices().filter((c) => !takenElsewhere.has(c.id));
  }
  openPosterPicker(slot: number): void {
    this.posterPickerSlot.set(slot);
  }
  closePosterPicker(): void {
    this.posterPickerSlot.set(null);
  }
  choosePosterCard(slot: number, card: DeckCard): void {
    this.posterSelection.set(this.posterSelection().map((c, i) => (i === slot ? card : c)));
    this.posterPickerSlot.set(null);
  }
  clearPosterSlot(slot: number): void {
    this.posterSelection.set(this.posterSelection().map((c, i) => (i === slot ? null : c)));
  }
  submitRename(): void {
    const name = this.renameName().trim();
    if (!name) {
      return;
    }
    const payload: DeckUpdate = {
      poster_card_ids: this.posterSelection()
        .filter((c): c is DeckCard => c !== null)
        .map((c) => c.id),
    };
    const nameChanged = name !== this.deck.name;
    if (nameChanged) {
      payload.name = name;
    }
    this.renameLoading.set(true);
    this.decksService.update(this.deck.id, payload).subscribe({
      next: (deck) => {
        this.renameLoading.set(false);
        this.renameOpen.set(false);
        if (nameChanged) {
          this.toastService.show(this.translate.instant('decks.renamedDeck', { name: deck.name }));
        }
        this.renamed.emit(deck);
      },
      error: (err) => {
        this.renameLoading.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('decks.renameDeckFailed'),
          'error',
        );
      },
    });
  }
  openDeleteConfirm(): void {
    this.deleteConfirmOpen.set(true);
  }
  closeDeleteConfirm(): void {
    this.deleteConfirmOpen.set(false);
  }
  confirmDelete(): void {
    this.deleteLoading.set(true);
    this.decksService.delete(this.deck.id).subscribe({
      next: () => {
        this.deleteLoading.set(false);
        this.deleteConfirmOpen.set(false);
        this.toastService.show(
          this.translate.instant('decks.deletedDeck', { name: this.deck.name }),
        );
        this.deleted.emit(this.deck.id);
      },
      error: (err) => {
        this.deleteLoading.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('decks.deleteDeckFailed'),
          'error',
        );
      },
    });
  }
  openHistory(): void {
    this.historyOpen.set(true);
    this.historyItems.set([]);
    this.historyPage.set(1);
    this.historyTotal.set(0);
    this.loadHistoryPage(1);
  }
  closeHistory(): void {
    this.historyOpen.set(false);
    this.historyObserver?.disconnect();
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
    this.decksService.history(this.deck.id, page).subscribe({
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
        this.toastService.show(this.translate.instant('decks.loadHistoryFailed'), 'error');
      },
    });
  }
  historyLabel(entry: DeckHistoryEntry): string {
    switch (entry.action) {
      case 'created':
        return this.translate.instant('decks.historyCreated', { name: entry.detail });
      case 'renamed':
        return this.translate.instant('decks.historyRenamed', {
          oldName: entry.old_value,
          newName: entry.new_value,
        });
      case 'description_changed':
        return this.translate.instant('decks.historyDescriptionChanged');
      case 'copied':
        return entry.detail ?? this.translate.instant('decks.historyCopied');
      case 'card_added':
        return this.translate.instant('decks.historyCardAdded', {
          quantity: entry.new_value,
          name: entry.detail,
        });
      case 'card_quantity_changed':
        return this.translate.instant('decks.historyCardQuantityChanged', {
          name: entry.detail,
          oldValue: entry.old_value,
          newValue: entry.new_value,
        });
      case 'card_removed':
        return this.translate.instant('decks.historyCardRemoved', {
          name: entry.detail,
          oldValue: entry.old_value,
        });
    }
  }
}
