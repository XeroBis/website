import { Icon } from '@shared';
import { signal } from '@angular/core';
import { AuthService } from '@shared';
import { inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Combat, CombatSnapshotCard, CombatWinner } from '../../models/combat.model';
import { VARIANT_BADGES, VariantType } from '../../models/card.model';
import { DeckCombatOption } from '../../models/deck.model';
import { User } from '../../models/user.model';
import { CardNameService } from '../../services/card-name.service';
import { CatalogService } from '../../services/catalog.service';
import { CombatsService } from '../../services/combats.service';
import { DecksService } from '../../services/decks.service';
import { ToastService } from '../../services/toast.service';
import { UsersService } from '../../services/users.service';
import { supertypeKey as supertypeKeyFor } from '../../util/card-type-translate.util';
import { CardDisplayNamePipe } from '../../util/card-display-name.pipe';
import { computeSupertypeCounts, SupertypeCounts } from '../../util/deck-visuals';
import { SORT_OPTIONS, sortCards, SortOption } from '../../util/sort.util';
import { ModalComponent } from '../shared/modal/modal.component';
import {
  SearchableSelectComponent,
  SearchableSelectItem,
} from '../shared/searchable-select/searchable-select.component';
interface CombatFormState {
  deck_a_id: number | null;
  player_a_id: number | null;
  deck_b_id: number | null;
  player_b_id: number | null;
  winner: CombatWinner | null;
  loser_score: number;
  played_at: string;
}
/** `<input type="date">` wants "yyyy-MM-dd" — only the day matters for played_at, no time. */
function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function emptyForm(): CombatFormState {
  return {
    deck_a_id: null,
    player_a_id: null,
    deck_b_id: null,
    player_b_id: null,
    winner: null,
    loser_score: 1,
    played_at: toDateInputValue(new Date()),
  };
}
@Component({
  selector: 'app-combats',
  imports: [
    Icon,
    CommonModule,
    FormsModule,
    ModalComponent,
    SearchableSelectComponent,
    TranslatePipe,
    CardDisplayNamePipe,
  ],
  templateUrl: './combats.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './combats.component.scss',
})
export class CombatsComponent implements OnInit {
  combats = signal<Combat[]>([]);
  decks = signal<DeckCombatOption[]>([]);
  users = signal<User[]>([]);
  loading = signal(false);
  logCombatOpen = signal(false);
  form = signal<CombatFormState>(emptyForm());
  submitting = signal(false);
  editOpen = signal(false);
  editCombat = signal<Combat | null>(null);
  editForm = signal<CombatFormState>(emptyForm());
  editSubmitting = signal(false);
  deleteCombat = signal<Combat | null>(null);
  deleteLoading = signal(false);
  viewSnapshot = signal<{
    deckName: string;
    cards: CombatSnapshotCard[];
  } | null>(null);
  snapshotSort = signal<SortOption>('name_asc');
  readonly sortOptions = SORT_OPTIONS;
  snapshotView = signal<'grid' | 'table'>('grid');
  snapshotSupertypeCounts = signal<SupertypeCounts>({ pokemon: 0, trainer: 0, energy: 0 });
  me = signal<User | null>(null);
  constructor(
    private readonly combatsService: CombatsService,
    private readonly decksService: DecksService,
    private readonly usersService: UsersService,
    private readonly toastService: ToastService,
    private readonly catalogService: CatalogService,
    private readonly translate: TranslateService,
    private readonly cardNameService: CardNameService,
  ) {}
  supertypeKey(value: string | null | undefined): string {
    return supertypeKeyFor(value);
  }
  variantBadge(card: CombatSnapshotCard): string {
    return VARIANT_BADGES[card.variant_type as VariantType] ?? '';
  }
  private readonly auth = inject(AuthService);
  ngOnInit(): void {
    this.load();
    this.decksService.listForCombat().subscribe({
      next: (decks) => {
        this.decks.set(decks);
        this.deckItems.set(
          decks.map((deck) => ({
            id: deck.id,
            label: `${deck.name} (${deck.owner_label})`,
          })),
        );
      },
      error: () =>
        this.toastService.show(this.translate.instant('combats.loadDecksFailed'), 'error'),
    });
    this.usersService.list().subscribe({
      next: (users) => this.users.set(users),
      error: () =>
        this.toastService.show(this.translate.instant('combats.loadUsersFailed'), 'error'),
    });
    this.auth
      .load()
      .then((me) => {
        this.me.set(me);
      })
      .catch(() =>
        this.toastService.show(this.translate.instant('combats.loadProfileFailed'), 'error'),
      );
  }
  deckItems = signal<SearchableSelectItem[]>([]);
  displayName(user: Pick<User, 'pseudo'>): string {
    return user.pseudo;
  }
  combatPlayerAName(combat: Combat): string {
    return combat.player_a_pseudo ?? '—';
  }
  combatPlayerBName(combat: Combat): string {
    return combat.player_b_pseudo ?? '—';
  }
  loserPlayerLabel(form: CombatFormState): string {
    const loserId = form.winner === 'a' ? form.player_b_id : form.player_a_id;
    const user = this.users().find((u) => u.id === loserId);
    return user ? this.displayName(user) : this.translate.instant('combats.theLoser');
  }
  load(): void {
    this.loading.set(true);
    this.combatsService.list().subscribe({
      next: (combats) => {
        this.combats.set(combats);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toastService.show(this.translate.instant('combats.loadCombatsFailed'), 'error');
      },
    });
  }
  private validationError(form: CombatFormState, original?: Combat): string | null {
    const missing: string[] = [];
    if (form.deck_a_id === null && original?.deck_a_id !== null)
      missing.push(this.translate.instant('combats.missingDeckA'));
    if (form.player_a_id === null) missing.push(this.translate.instant('combats.missingPlayerA'));
    if (form.deck_b_id === null && original?.deck_b_id !== null)
      missing.push(this.translate.instant('combats.missingDeckB'));
    if (form.player_b_id === null) missing.push(this.translate.instant('combats.missingPlayerB'));
    if (form.winner === null) missing.push(this.translate.instant('combats.missingWinner'));
    if (!form.played_at) missing.push(this.translate.instant('combats.missingPlayedDate'));
    if (missing.length > 0) {
      return this.translate.instant('combats.missingSummary', { list: missing.join(', ') });
    }
    if (form.loser_score < 1 || form.loser_score > 6) {
      return this.translate.instant('combats.loserScoreRange');
    }
    return null;
  }
  setWinner(form: CombatFormState, winner: CombatWinner): void {
    form.winner = winner;
  }
  stepLoserScore(form: CombatFormState, delta: number): void {
    const next = form.loser_score + delta;
    if (next < 1 || next > 6) {
      return;
    }
    form.loser_score = next;
  }
  openLogCombat(): void {
    this.form.set(emptyForm());
    this.logCombatOpen.set(true);
  }
  closeLogCombat(): void {
    if (!this.submitting()) {
      this.logCombatOpen.set(false);
    }
  }
  logCombat(): void {
    const error = this.validationError(this.form());
    if (error) {
      this.toastService.show(error, 'error');
      return;
    }
    this.submitting.set(true);
    this.combatsService
      .create({
        deck_a_id: this.form().deck_a_id!,
        player_a_id: this.form().player_a_id!,
        deck_b_id: this.form().deck_b_id!,
        player_b_id: this.form().player_b_id!,
        winner: this.form().winner!,
        loser_score: this.form().loser_score,
        played_at: new Date(this.form().played_at).toISOString(),
      })
      .subscribe({
        next: (combat) => {
          this.submitting.set(false);
          this.combats.set(
            [combat, ...this.combats()].sort(
              (a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime(),
            ),
          );
          this.form.set(emptyForm());
          this.logCombatOpen.set(false);
          this.toastService.show(this.translate.instant('combats.combatLogged'));
        },
        error: (err) => {
          this.submitting.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('combats.logCombatFailed'),
            'error',
          );
        },
      });
  }
  viewDeckASnapshot(combat: Combat): void {
    this.openSnapshot(combat.deck_a_name, combat.deck_a_snapshot);
  }
  viewDeckBSnapshot(combat: Combat): void {
    this.openSnapshot(combat.deck_b_name, combat.deck_b_snapshot);
  }
  private openSnapshot(deckName: string, cards: CombatSnapshotCard[]): void {
    this.viewSnapshot.set({ deckName, cards });
    this.snapshotSort.set('name_asc');
    this.snapshotView.set('grid');
    this.snapshotSupertypeCounts.set(computeSupertypeCounts(cards));
  }
  closeViewSnapshot(): void {
    this.viewSnapshot.set(null);
  }
  get sortedSnapshotCards(): CombatSnapshotCard[] {
    return this.viewSnapshot()
      ? sortCards(this.viewSnapshot()!.cards, this.snapshotSort(), (card) =>
          this.cardNameService.displayName(card.name),
        )
      : [];
  }
  setSnapshotView(view: 'grid' | 'table'): void {
    this.snapshotView.set(view);
  }
  imageUrl(imagePath: string): string {
    return this.catalogService.thumbnailUrl(imagePath);
  }
  openEdit(combat: Combat): void {
    this.editCombat.set(combat);
    this.editForm.set({
      deck_a_id: combat.deck_a_id,
      player_a_id: combat.player_a_id,
      deck_b_id: combat.deck_b_id,
      player_b_id: combat.player_b_id,
      winner: combat.winner,
      loser_score: combat.loser_score,
      played_at: toDateInputValue(new Date(combat.played_at)),
    });
    this.editOpen.set(true);
  }
  closeEdit(): void {
    this.editOpen.set(false);
    this.editCombat.set(null);
  }
  submitEdit(): void {
    if (!this.editCombat()) {
      return;
    }
    const error = this.validationError(this.editForm(), this.editCombat()!);
    if (error) {
      this.toastService.show(error, 'error');
      return;
    }
    this.editSubmitting.set(true);
    this.combatsService
      .update(this.editCombat()!.id, {
        deck_a_id: this.editForm().deck_a_id!,
        player_a_id: this.editForm().player_a_id!,
        deck_b_id: this.editForm().deck_b_id!,
        player_b_id: this.editForm().player_b_id!,
        winner: this.editForm().winner!,
        loser_score: this.editForm().loser_score,
        played_at: new Date(this.editForm().played_at).toISOString(),
      })
      .subscribe({
        next: (updated) => {
          this.editSubmitting.set(false);
          this.combats.set(
            this.combats()
              .map((c) => (c.id === updated.id ? updated : c))
              .sort((a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime()),
          );
          this.toastService.show(this.translate.instant('combats.combatUpdated'));
          this.closeEdit();
        },
        error: (err) => {
          this.editSubmitting.set(false);
          this.toastService.show(
            err?.error?.detail ?? this.translate.instant('combats.updateCombatFailed'),
            'error',
          );
        },
      });
  }
  openDeleteConfirm(combat: Combat): void {
    this.deleteCombat.set(combat);
  }
  closeDeleteConfirm(): void {
    this.deleteCombat.set(null);
  }
  confirmDelete(): void {
    if (!this.deleteCombat()) {
      return;
    }
    const id = this.deleteCombat()!.id;
    this.deleteLoading.set(true);
    this.combatsService.delete(id).subscribe({
      next: () => {
        this.deleteLoading.set(false);
        this.combats.set(this.combats().filter((c) => c.id !== id));
        this.toastService.show(this.translate.instant('combats.combatDeleted'));
        this.deleteCombat.set(null);
      },
      error: (err) => {
        this.deleteLoading.set(false);
        this.toastService.show(
          err?.error?.detail ?? this.translate.instant('combats.deleteCombatFailed'),
          'error',
        );
      },
    });
  }
}
