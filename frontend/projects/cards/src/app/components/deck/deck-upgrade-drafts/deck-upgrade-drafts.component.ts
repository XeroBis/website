import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { signal } from '@angular/core';
import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import {
  CardCatalogEntry,
  CardCatalogVariant,
  CardSet,
  VARIANT_LABELS,
  VariantType,
} from '../../../models/card.model';
import {
  Deck,
  DeckDetail,
  DeckExportTextFormat,
  DeckUpgradeDraft,
  DeckUpgradeDraftDetail,
  DraftExportMode,
} from '../../../models/deck.model';
import { CardNameService } from '../../../services/card-name.service';
import { CatalogService } from '../../../services/catalog.service';
import { DeckUpgradeDraftsService } from '../../../services/deck-upgrade-drafts.service';
import { ToastService } from '../../../services/toast.service';
import { CardDisplayNamePipe } from '../../../util/card-display-name.pipe';
import { rarityCategories, rawRaritiesForCategory } from '../../../util/rarity-category.util';
import { sortCards, SortOption } from '../../../util/sort.util';
import { FiltersPanelComponent } from '../../shared/filters-panel/filters-panel.component';
import { ModalComponent } from '../../shared/modal/modal.component';
/** A row in the unified draft editor list -- either a card already in the
 * deck, a proposed addition/removal, or both merged together so each card
 * only appears once with its current qty, proposed delta, and (implied)
 * resulting qty all in one tile. */
interface DraftUnifiedCard {
  catalog_id: number;
  variant_type: VariantType;
  name: string;
  set_name: string;
  image_path: string;
  supertype: string | null;
  baseline_quantity: number;
  quantity_delta: number;
  result_quantity: number;
  available: number;
  hasEntry: boolean;
}
/** "Deck Upgrade Drafts" -- Normal decks only. A "Drafts" button opens a small
 * list modal (open/rename/delete/create), and opening/creating a draft opens
 * a full-screen editor: a single unified card grid (current qty + proposed
 * delta on each tile) plus an on-demand "Add cards" drawer for pasting a
 * decklist diff or searching the catalog.
 * See documentation/features.md's "Deck Upgrade Drafts". */
@Component({
  selector: 'app-deck-upgrade-drafts',
  imports: [FormsModule, ModalComponent, FiltersPanelComponent, TranslatePipe, CardDisplayNamePipe],
  templateUrl: './deck-upgrade-drafts.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './deck-upgrade-drafts.component.scss',
})
export class DeckUpgradeDraftsComponent {
  @Input({ required: true })
  deck!: Deck;
  @Output()
  applied = new EventEmitter<DeckDetail>();
  listOpen = signal(false);
  listLoading = signal(false);
  drafts = signal<DeckUpgradeDraft[]>([]);
  newDraftName = signal('');
  creating = signal(false);
  renamingDraftId = signal<number | null>(null);
  renameName = signal('');
  confirmDeleteId = signal<number | null>(null);
  exportOpen = signal(false);
  exportDraftId = signal<number | null>(null);
  exportMode = signal<DraftExportMode>('missing');
  exportIncludeSets = signal(true);
  exporting = signal(false);
  editorOpen = signal(false);
  editorLoading = signal(false);
  draft = signal<DeckUpgradeDraftDetail | null>(null);
  applying = signal(false);
  /** The "Add cards" drawer (paste-diff + catalog search), opened on demand
   * from the editor header instead of taking up a permanent column. */
  addPanelOpen = signal(false);
  /** Collapsed by default -- the catalog search is the primary way to add
   * cards, so the paste box only takes up space once opened. */
  pasteBoxOpen = signal(false);
  pasteText = signal('');
  pasteSubmitting = signal(false);
  togglePasteBox(): void {
    this.pasteBoxOpen.set(!this.pasteBoxOpen());
  }
  /** Collapsible on narrow screens so the search results grid is visible by
   * default instead of being pushed below the (much taller, stacked)
   * filters form -- always shown side-by-side with results on wider
   * screens regardless of this flag (see the >900px override in the
   * stylesheet). */
  searchFiltersOpen = signal(true);
  toggleSearchFilters(): void {
    this.searchFiltersOpen.set(!this.searchFiltersOpen());
  }
  /** Catalog search inside the "Add cards" panel -- same filter set as
   * Browse/Collection (`FiltersPanelComponent`, embedded `[inline]`), so
   * finding a card to add isn't limited to a plain text box. */
  sets = signal<CardSet[]>([]);
  rarities = signal<string[]>([]);
  private searchFiltersLoaded = false;
  search = signal('');
  setCode = signal('');
  setFilter = signal('');
  supertype = signal<string[]>([]);
  rarity = signal<string[]>([]);
  sort = signal<SortOption>('name_asc');
  searchResults = signal<CardCatalogEntry[]>([]);
  searchTotal = signal(0);
  searchLoading = signal(false);
  private latestSearchRequestId = 0;
  private readonly filterChanged = new Subject<void>();
  /** Set right before we call `history.back()` ourselves (closing a modal
   * via its own close button, not the browser's back button) so the
   * `popstate` this triggers is swallowed instead of also closing the
   * *other* modal underneath -- see `popModalHistoryStateIfOwned()`. */
  private suppressNextPopState = false;
  constructor(
    private readonly draftsService: DeckUpgradeDraftsService,
    private readonly catalogService: CatalogService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
    private readonly cardNameService: CardNameService,
  ) {
    this.filterChanged
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.runSearch());
  }
  /** The editor and "Add cards" modals each push a history entry while
   * open, so the browser's back button closes the topmost one instead of
   * navigating away from the deck page. */
  @HostListener('window:popstate')
  onPopState(): void {
    if (this.suppressNextPopState) {
      this.suppressNextPopState = false;
      return;
    }
    if (this.addPanelOpen()) {
      this.addPanelOpen.set(false);
    } else if (this.editorOpen()) {
      this.editorOpen.set(false);
      this.draft.set(null);
    }
  }
  private pushModalHistoryState(): void {
    history.pushState({ pkmDraftModal: true }, '');
  }
  /** Pops the history entry a modal pushed when it opened, so closing it
   * via its own close button (rather than the browser back button) doesn't
   * leave a dangling forward-history entry. Suppresses the `popstate` this
   * triggers, since we already closed the modal directly above. */
  private popModalHistoryStateIfOwned(): void {
    if (
      (
        history.state as {
          pkmDraftModal?: boolean;
        } | null
      )?.pkmDraftModal
    ) {
      this.suppressNextPopState = true;
      history.back();
    }
  }
  thumbnailUrl(imagePath: string): string {
    return this.catalogService.thumbnailUrl(imagePath);
  }
  openAddPanel(): void {
    this.addPanelOpen.set(true);
    this.searchFiltersOpen.set(window.innerWidth > 900);
    this.pushModalHistoryState();
    if (!this.searchFiltersLoaded) {
      this.searchFiltersLoaded = true;
      this.catalogService.listSets().subscribe((sets) => this.sets.set(sets));
      this.catalogService
        .listRarities()
        .subscribe((rarities) => this.rarities.set(rarityCategories(rarities)));
    }
    this.runSearch();
  }
  closeAddPanel(): void {
    this.addPanelOpen.set(false);
    this.popModalHistoryStateIfOwned();
  }
  /** Merges `current_cards` and `entries` into one row per card, so the
   * editor shows a single grid instead of separate current/changes/result
   * columns. A card already in the deck with no proposed change shows just
   * its current qty; a proposed change (on a current card or a brand new
   * one) additionally shows the delta badge. */
  get unifiedCards(): DraftUnifiedCard[] {
    if (!this.draft()) {
      return [];
    }
    const key = (catalogId: number, variantType: VariantType) => `${catalogId}:${variantType}`;
    const entriesByKey = new Map(
      this.draft()!.entries.map((e) => [key(e.catalog_id, e.variant_type), e])!,
    );
    const rows: DraftUnifiedCard[] = [];
    const seen = new Set<string>();
    for (const c of this.draft()!.current_cards) {
      if (c.catalog_id == null) {
        continue;
      }
      const k = key(c.catalog_id, c.variant_type);
      seen.add(k);
      const entry = entriesByKey.get(k);
      rows.push({
        catalog_id: c.catalog_id,
        variant_type: c.variant_type,
        name: c.name,
        set_name: c.set_name,
        image_path: c.image_path,
        supertype: c.supertype,
        baseline_quantity: entry?.baseline_quantity ?? c.quantity_in_deck,
        quantity_delta: entry?.quantity_delta ?? 0,
        result_quantity: entry?.result_quantity ?? c.quantity_in_deck,
        available: entry?.available ?? 0,
        hasEntry: !!entry,
      });
    }
    for (const e of this.draft()!.entries) {
      const k = key(e.catalog_id, e.variant_type);
      if (seen.has(k)) {
        continue;
      }
      rows.push({
        catalog_id: e.catalog_id,
        variant_type: e.variant_type,
        name: e.name,
        set_name: e.set_name,
        image_path: e.image_path,
        supertype: e.supertype,
        baseline_quantity: e.baseline_quantity,
        quantity_delta: e.quantity_delta,
        result_quantity: e.result_quantity,
        available: e.available,
        hasEntry: true,
      });
    }
    return sortCards(rows, 'supertype', this.getName);
  }
  private readonly getName = (card: { name: string }): string =>
    this.cardNameService.displayName(card.name);
  // ---- drafts list modal ----
  openList(): void {
    this.listOpen.set(true);
    this.newDraftName.set('');
    this.renamingDraftId.set(null);
    this.confirmDeleteId.set(null);
    this.loadDrafts();
  }
  closeList(): void {
    this.listOpen.set(false);
  }
  private loadDrafts(): void {
    this.listLoading.set(true);
    this.draftsService.list(this.deck.id).subscribe({
      next: (drafts) => {
        this.drafts.set(drafts);
        this.listLoading.set(false);
      },
      error: () => {
        this.listLoading.set(false);
        this.toastService.show(this.translate.instant('decks.drafts.loadFailed'), 'error');
      },
    });
  }
  createDraft(): void {
    const name = this.newDraftName().trim();
    if (!name || this.creating()) {
      return;
    }
    this.creating.set(true);
    this.draftsService.create(this.deck.id, { name }).subscribe({
      next: (detail) => {
        this.creating.set(false);
        this.newDraftName.set('');
        this.listOpen.set(false);
        this.openEditorFromDetail(detail);
      },
      error: (err) => {
        this.creating.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('decks.drafts.createFailed'),
          'error',
        );
      },
    });
  }
  startRename(draft: DeckUpgradeDraft): void {
    this.renamingDraftId.set(draft.id);
    this.renameName.set(draft.name);
  }
  cancelRename(): void {
    this.renamingDraftId.set(null);
  }
  submitRename(draft: DeckUpgradeDraft): void {
    const name = this.renameName().trim();
    if (!name || name === draft.name) {
      this.renamingDraftId.set(null);
      return;
    }
    this.draftsService.rename(this.deck.id, draft.id, { name }).subscribe({
      next: (updated) => {
        draft.name = updated.name;
        draft.updated_at = updated.updated_at;
        this.renamingDraftId.set(null);
      },
      error: (err) => {
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('decks.drafts.renameFailed'),
          'error',
        );
      },
    });
  }
  askDeleteDraft(draft: DeckUpgradeDraft): void {
    this.confirmDeleteId.set(draft.id);
  }
  cancelDeleteDraft(): void {
    this.confirmDeleteId.set(null);
  }
  confirmDeleteDraft(draft: DeckUpgradeDraft): void {
    this.draftsService.delete(this.deck.id, draft.id).subscribe({
      next: () => {
        this.drafts.set(this.drafts().filter((d) => d.id !== draft.id));
        this.confirmDeleteId.set(null);
      },
      error: (err) => {
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('decks.drafts.deleteFailed'),
          'error',
        );
      },
    });
  }
  // ---- export missing cards (list row action + editor header button) ----
  openExport(draftId: number): void {
    this.exportDraftId.set(draftId);
    this.exportMode.set('missing');
    this.exportIncludeSets.set(true);
    this.exportOpen.set(true);
  }
  closeExport(): void {
    if (!this.exporting()) {
      this.exportOpen.set(false);
    }
  }
  doExport(format: DeckExportTextFormat): void {
    if (this.exportDraftId()! === null || this.exporting()) {
      return;
    }
    this.exporting.set(true);
    this.draftsService
      .exportDraftText(
        this.deck.id,
        this.exportDraftId()!,
        format,
        this.exportMode(),
        this.exportIncludeSets(),
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
  openEditor(draftSummary: DeckUpgradeDraft): void {
    this.editorLoading.set(true);
    this.editorOpen.set(true);
    this.listOpen.set(false);
    this.draftsService.get(this.deck.id, draftSummary.id).subscribe({
      next: (detail) => {
        this.editorLoading.set(false);
        this.openEditorFromDetail(detail);
      },
      error: () => {
        this.editorLoading.set(false);
        this.editorOpen.set(false);
        this.toastService.show(this.translate.instant('decks.drafts.loadFailed'), 'error');
      },
    });
  }
  private openEditorFromDetail(detail: DeckUpgradeDraftDetail): void {
    this.draft.set(detail);
    this.editorOpen.set(true);
    this.editorLoading.set(false);
    this.pushModalHistoryState();
    this.addPanelOpen.set(false);
    this.pasteBoxOpen.set(false);
    this.pasteText.set('');
    this.search.set('');
    this.setCode.set('');
    this.setFilter.set('');
    this.supertype.set([]);
    this.rarity.set([]);
    this.sort.set('name_asc');
    this.searchResults.set([]);
    this.searchTotal.set(0);
  }
  closeEditor(): void {
    this.editorOpen.set(false);
    this.draft.set(null);
    this.popModalHistoryStateIfOwned();
  }
  // ---- editor: paste / JSON diff ----
  onPasteTextChange(): void {
    // Intentionally not auto-diffed on every keystroke -- pasting/replacing a
    // draft's entries is a deliberate action (submitDiffFromPaste), not a
    // live preview, since it discards existing entries.
  }
  submitDiffFromPaste(): void {
    if (!this.draft()! || !this.pasteText().trim() || this.pasteSubmitting()) {
      return;
    }
    this.pasteSubmitting.set(true);
    this.draftsService
      .replaceFromPaste(this.deck.id, this.draft()!.id, { decklist_text: this.pasteText() })
      .subscribe({
        next: (detail) => {
          this.pasteSubmitting.set(false);
          this.pasteText.set('');
          this.pasteBoxOpen.set(false);
          this.draft.set(detail);
          this.addPanelOpen.set(false);
          this.toastService.show(this.translate.instant('decks.drafts.pasteDiffApplied'));
        },
        error: (err) => {
          this.pasteSubmitting.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('decks.drafts.pasteDiffFailed'),
            'error',
          );
        },
      });
  }
  // ---- editor: individual add via catalog search ----
  get hasActiveSearchFilters(): boolean {
    return (
      !!this.search() ||
      !!this.setCode() ||
      !!this.setFilter() ||
      this.supertype().length > 0 ||
      this.rarity().length > 0 ||
      this.sort() !== 'name_asc'
    );
  }
  get searchCountLabel(): string {
    return this.translate.instant(
      this.searchTotal() === 1
        ? 'decks.drafts.searchResultCount'
        : 'decks.drafts.searchResultCountPlural',
      { count: this.searchTotal() },
    );
  }
  onSearchFilterChange(): void {
    this.filterChanged.next();
  }
  clearSearchFilters(): void {
    this.search.set('');
    this.setCode.set('');
    this.setFilter.set('');
    this.supertype.set([]);
    this.rarity.set([]);
    this.sort.set('name_asc');
    this.runSearch();
  }
  private runSearch(): void {
    this.searchLoading.set(true);
    const requestId = ++this.latestSearchRequestId;
    this.catalogService
      .browse({
        search: this.search() || undefined,
        setCode: this.setCode() || undefined,
        setName: (!this.setCode() && this.setFilter()) || undefined,
        supertype: this.supertype().length ? this.supertype() : undefined,
        rarity: this.rarity().length ? this.rarity().flatMap(rawRaritiesForCategory) : undefined,
        sort: this.sort(),
        page: 1,
        pageSize: 60,
      })
      .subscribe({
        next: (page) => {
          if (requestId !== this.latestSearchRequestId) {
            return;
          }
          this.searchResults.set(page.items);
          this.searchTotal.set(page.total);
          this.searchLoading.set(false);
        },
        error: () => {
          if (requestId !== this.latestSearchRequestId) {
            return;
          }
          this.searchLoading.set(false);
        },
      });
  }
  deltaFor(catalogId: number, variantType: VariantType = 'standard'): number {
    return (
      this.draft()?.entries.find(
        (e) => e.catalog_id === catalogId && e.variant_type === variantType,
      )?.quantity_delta ?? 0
    );
  }
  baselineFor(catalogId: number, variantType: VariantType = 'standard'): number {
    return (
      this.draft()?.current_cards.find(
        (c) => c.catalog_id === catalogId && c.variant_type === variantType,
      )?.quantity_in_deck ?? 0
    );
  }
  /** Available print variants per catalog card, fetched lazily as search
   * results appear -- drives each result tile's variant dropdown, same
   * pattern as CollectionAddPanelComponent. Keyed by catalogId. */
  variantsByCard = signal<Record<number, VariantType[]>>({});
  /** The variant currently selected for each search result tile, defaulting
   * to 'standard' -- see addFromSearch. */
  selectedVariantByCard = signal<Record<number, VariantType>>({});
  private loadVariantsFor(catalogId: number): void {
    if (this.variantsByCard()[catalogId]) {
      return;
    }
    this.catalogService.getCardVariants(catalogId).subscribe((variants: CardCatalogVariant[]) => {
      this.variantsByCard.update((value) => {
        const next = { ...value };
        next[catalogId] = variants.map((v) => v.variant_type);
        return next;
      });
    });
  }
  variantOptionsFor(catalogId: number): VariantType[] {
    this.loadVariantsFor(catalogId);
    return this.variantsByCard()[catalogId] ?? ['standard'];
  }
  variantLabel(v: VariantType): string {
    return VARIANT_LABELS[v];
  }
  selectedVariantFor(catalogId: number): VariantType {
    return this.selectedVariantByCard()[catalogId] ?? 'standard';
  }
  setSelectedVariant(catalogId: number, variantType: VariantType): void {
    this.selectedVariantByCard.update((value) => {
      const next = { ...value };
      next[catalogId] = variantType;
      return next;
    });
  }
  addFromSearch(entry: CardCatalogEntry): void {
    const variantType = this.selectedVariantFor(entry.id);
    const newDelta = this.deltaFor(entry.id, variantType) + 1;
    this.setEntryDelta(entry.id, variantType, newDelta);
  }
  // ---- editor: proposed-change entries ----
  incrementEntry(catalogId: number, variantType: VariantType = 'standard'): void {
    this.setEntryDelta(catalogId, variantType, this.deltaFor(catalogId, variantType) + 1);
  }
  decrementEntry(catalogId: number, variantType: VariantType = 'standard'): void {
    const baseline = this.baselineFor(catalogId, variantType);
    const newDelta = this.deltaFor(catalogId, variantType) - 1;
    if (baseline + newDelta < 0) {
      return;
    }
    this.setEntryDelta(catalogId, variantType, newDelta);
  }
  removeEntry(catalogId: number, variantType: VariantType = 'standard'): void {
    if (!this.draft()) {
      return;
    }
    this.draftsService
      .removeEntry(this.deck.id, this.draft()!.id, catalogId, variantType)
      .subscribe({
        next: (detail) => this.draft.set(detail),
        error: (err) => {
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('decks.drafts.entryUpdateFailed'),
            'error',
          );
        },
      });
  }
  private setEntryDelta(catalogId: number, variantType: VariantType, delta: number): void {
    if (!this.draft()) {
      return;
    }
    if (delta === 0) {
      this.removeEntry(catalogId, variantType);
      return;
    }
    this.draftsService
      .upsertEntry(
        this.deck.id,
        this.draft()!.id,
        catalogId,
        { quantity_delta: delta },
        variantType,
      )
      .subscribe({
        next: (detail) => this.draft.set(detail),
        error: (err) => {
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('decks.drafts.entryUpdateFailed'),
            'error',
          );
        },
      });
  }
  // ---- editor: apply ----
  applyDraft(): void {
    if (!this.draft()! || !this.draft()!.can_apply || this.applying()) {
      return;
    }
    this.applying.set(true);
    this.draftsService.apply(this.deck.id, this.draft()!.id).subscribe({
      next: (deck) => {
        this.applying.set(false);
        this.toastService.show(this.translate.instant('decks.drafts.applied'));
        this.closeEditor();
        this.applied.emit(deck);
      },
      error: (err) => {
        this.applying.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('decks.drafts.applyFailed'),
          'error',
        );
      },
    });
  }
}
