import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Icon } from '@shared';
import { signal } from '@angular/core';
import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { forkJoin, of, Subject } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map } from 'rxjs/operators';
import { DecklistConvertEntry } from '../../../models/card.model';
import { Deck, DeckType } from '../../../models/deck.model';
import { CatalogService } from '../../../services/catalog.service';
import { ConvertService } from '../../../services/convert.service';
import { DecksService } from '../../../services/decks.service';
import { ToastService } from '../../../services/toast.service';
import { CardDisplayNamePipe } from '../../../util/card-display-name.pipe';
import {
  computeEnergyBadges,
  energyIconUrl as toEnergyIconUrl,
  EnergyBadge,
  posterSlots,
} from '../../../util/deck-visuals';
import { DecklistPreviewComponent } from '../../shared/decklist-preview/decklist-preview.component';
import { ModalComponent } from '../../shared/modal/modal.component';
import { DeckActionsComponent } from '../deck-actions/deck-actions.component';
import { MultiDraftExportComponent } from '../multi-draft-export/multi-draft-export.component';
interface DeckVisuals {
  energyBadges: EnergyBadge[];
}
@Component({
  selector: 'app-deck-list',
  imports: [
    Icon,
    FormsModule,
    RouterLink,
    DeckActionsComponent,
    ModalComponent,
    DecklistPreviewComponent,
    MultiDraftExportComponent,
    TranslatePipe,
    CardDisplayNamePipe,
  ],
  templateUrl: './deck-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './deck-list.component.scss',
})
export class DeckListComponent implements OnInit {
  decks = signal<Deck[]>([]);
  loading = signal(false);
  visualsLoaded = signal(false);
  search = signal('');
  deckVisuals = signal<Record<number, DeckVisuals>>({});
  createDeckOpen = signal(false);
  createDeckLoading = signal(false);
  newDeckName = signal('');
  newDeckDescription = signal('');
  newDeckType = signal<DeckType>('normal');
  newDeckDecklistText = signal('');
  decklistPreviewEntries = signal<DecklistConvertEntry[]>([]);
  decklistPreviewLoading = signal(false);
  decklistOpen = signal(false);
  private readonly decklistTextChanged = new Subject<string>();
  constructor(
    private readonly decksService: DecksService,
    private readonly catalogService: CatalogService,
    private readonly convertService: ConvertService,
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
    private readonly router: Router,
  ) {
    this.decklistTextChanged
      .pipe(debounceTime(400), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((text) => {
        this.previewDecklist(text);
      });
  }
  ngOnInit(): void {
    this.load();
  }
  openDeck(deckId: number): void {
    this.router.navigate(['/decks', deckId]);
  }
  load(): void {
    this.loading.set(true);
    this.visualsLoaded.set(false);
    this.decksService.list().subscribe({
      next: (decks) => {
        this.decks.set(decks);
        this.loading.set(false);
        this.loadVisuals(decks);
      },
      error: () => this.loading.set(false),
    });
  }
  get filteredDecks(): Deck[] {
    const term = this.search().trim().toLowerCase();
    if (!term) {
      return this.decks();
    }
    return this.decks().filter((d) => d.name.toLowerCase().includes(term));
  }
  private loadVisuals(decks: Deck[]): void {
    if (decks.length === 0) {
      this.visualsLoaded.set(true);
      return;
    }
    forkJoin(
      decks.map((deck) =>
        this.decksService.get(deck.id).pipe(
          map((detail) => ({
            id: deck.id,
            energyBadges: computeEnergyBadges(detail.cards),
          })),
          catchError(() => of(null)),
        ),
      ),
    ).subscribe((results) => {
      const visuals: Record<number, DeckVisuals> = {};
      for (const result of results) {
        if (result) {
          visuals[result.id] = { energyBadges: result.energyBadges };
        }
      }
      this.deckVisuals.set(visuals);
      this.visualsLoaded.set(true);
    });
  }
  visualsFor(deckId: number): DeckVisuals {
    return this.deckVisuals()[deckId] ?? { energyBadges: [] };
  }
  imageUrl(imagePath: string): string {
    return this.catalogService.thumbnailUrl(imagePath);
  }
  posterSlots(deck: Deck) {
    return posterSlots(deck.poster_cards);
  }
  energyIconUrl(icon: string): string {
    return toEnergyIconUrl(icon);
  }
  openCreateDeck(): void {
    this.newDeckName.set('');
    this.newDeckDescription.set('');
    this.newDeckType.set('normal');
    this.newDeckDecklistText.set('');
    this.decklistPreviewEntries.set([]);
    this.decklistOpen.set(false);
    this.createDeckOpen.set(true);
  }
  closeCreateDeck(): void {
    if (!this.createDeckLoading()) {
      this.createDeckOpen.set(false);
    }
  }
  toggleDecklist(): void {
    this.decklistOpen.set(!this.decklistOpen());
  }
  onDecklistTextChange(): void {
    this.decklistTextChanged.next(this.newDeckDecklistText());
  }
  private previewDecklist(text: string): void {
    if (!text.trim()) {
      this.decklistPreviewEntries.set([]);
      this.decklistPreviewLoading.set(false);
      return;
    }
    this.decklistPreviewLoading.set(true);
    this.convertService.convertDecklist(text).subscribe({
      next: (res) => {
        this.decklistPreviewEntries.set(res.entries);
        this.decklistPreviewLoading.set(false);
      },
      error: () => {
        this.decklistPreviewLoading.set(false);
      },
    });
  }
  createDeck(): void {
    if (!this.newDeckName().trim()) {
      return;
    }
    this.createDeckLoading.set(true);
    this.decksService
      .create({
        name: this.newDeckName().trim(),
        description: this.newDeckDescription() || null,
        deck_type: this.newDeckType(),
        decklist_text: this.newDeckDecklistText().trim() || null,
      })
      .subscribe({
        next: (deck) => {
          this.createDeckLoading.set(false);
          this.createDeckOpen.set(false);
          this.decks.update((value) => {
            const next = [...value];
            next.push(deck);
            return next;
          });
          this.toastService.show(this.translate.instant('decks.createdDeck', { name: deck.name }));
        },
        error: (err) => {
          this.createDeckLoading.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('decks.createDeckFailed'),
            'error',
          );
        },
      });
  }
  onDeleted(deckId: number): void {
    this.decks.set(this.decks().filter((d) => d.id !== deckId));
  }
  onRenamed(deck: Deck): void {
    const index = this.decks().findIndex((d) => d.id === deck.id);
    if (index !== -1) {
      this.decks.update((value) => {
        const next = [...value];
        next[index] = { ...next[index], name: deck.name, poster_cards: deck.poster_cards };
        return next;
      });
    }
  }
  onCopied(deck: Deck): void {
    this.decks.update((value) => {
      const next = [...value];
      next.push(deck);
      return next;
    });
    this.decksService.get(deck.id).subscribe((detail) => {
      this.deckVisuals.set({
        ...this.deckVisuals(),
        [deck.id]: { energyBadges: computeEnergyBadges(detail.cards) },
      });
    });
  }
}
