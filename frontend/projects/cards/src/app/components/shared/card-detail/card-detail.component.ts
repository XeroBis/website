import { Icon } from '@shared';
import { signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  Card,
  CardDetails,
  CardCatalogDeckUsage,
  CardCatalogEntry,
  CardCatalogVariant,
  VARIANT_LABELS,
  VariantType,
} from '../../../models/card.model';
import { supertypeKey as supertypeKeyFor } from '../../../util/card-type-translate.util';
import { CardDisplayNamePipe } from '../../../util/card-display-name.pipe';
import { CatalogService } from '../../../services/catalog.service';
import { ToastService } from '../../../services/toast.service';
/** Which fields (if any) the host page lets the user edit inline in this
 * component's "Edit" mode -- kept as a single component since the two
 * pages only ever needed one details modal, not one each. */
export type CardDetailEditMode = 'none' | 'catalog-name' | 'collection';
@Component({
  selector: 'app-card-detail',
  imports: [Icon, CommonModule, FormsModule, TranslatePipe, CardDisplayNamePipe],
  templateUrl: './card-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './card-detail.component.scss',
})
export class CardDetailComponent implements OnChanges {
  @Input({ required: true })
  card!: CardCatalogEntry | Card;
  /** The card's standard-print image URL -- the fallback shown whenever
   * no other variant is picked, and whenever the selected variant has no
   * scan of its own yet. */
  @Input({ required: true })
  imageUrl!: string;
  @Input()
  editMode: CardDetailEditMode = 'none';
  /** Which variant tile the host opened this modal from (e.g. a
   * `both`-mode grid tile) -- preselects the variant picker below to match,
   * so the modal doesn't flash the standard print before showing the tile's
   * own image. Defaults to 'standard' when not given. */
  @Input()
  initialVariantType: VariantType | null = null;
  /** Emits the trimmed new name when saving in 'catalog-name' edit mode. */
  @Output()
  saveName = new EventEmitter<string>();
  /** Emits one variant's new quantity when saving in 'collection' edit
   * mode -- each variant stepper saves independently (see data-model.md's
   * `card_variant_quantities`). quantity 0 deletes that variant (and the
   * whole card if it was the last one). */
  @Output()
  saveQuantity = new EventEmitter<{
    variantType: VariantType;
    quantity: number;
  }>();
  /** Emitted when the delete action is used in 'collection' edit mode. */
  @Output()
  deleteCard = new EventEmitter<void>();
  editing = signal(false);
  editName = signal('');
  constructor(
    private readonly toastService: ToastService,
    private readonly translate: TranslateService,
    private readonly catalogService: CatalogService,
  ) {}
  /** Every print variant this card actually comes in (standard/reverse
   * always included), fetched from card_catalog_variants -- drives both the
   * quantity steppers in 'collection' edit mode (including not-yet-owned
   * variants the user can start adding, see features.md's "Edit a card")
   * and the image picker strip below the main image (see "Card detail
   * view"). Falls back to just 'standard' until loaded. */
  availableVariants = signal<CardCatalogVariant[]>([
    { variant_type: 'standard', image_path_fr: null, image_path_us: null },
  ]);
  /** Which variant's image is currently shown in the main image slot --
   * independent of the 'collection' edit panel's per-variant quantity rows
   * below, which always list every variant regardless of this selection. */
  selectedVariantType = signal<VariantType>('standard');
  /** Which decks (real allocation + phantom want-lists) reference this
   * card, regardless of which page opened the modal -- see "Card detail
   * view" in features.md. Null until loaded. */
  deckUsage = signal<CardCatalogDeckUsage | null>(null);
  details = signal<CardDetails | null>(null);
  detailsLanguage = signal<string | null>(null);
  private detailRequest = 0;
  get translateLanguage(): string {
    return this.translate.currentLang() === 'fr' ? 'fr' : 'en';
  }
  private loadDetails(): void {
    const request = ++this.detailRequest;
    this.details.set(null);
    this.detailsLanguage.set(null);
    const catalogId = this.collectionCard?.catalog_id ?? this.card.id;
    this.catalogService.getById(catalogId).subscribe({
      next: (card) => {
        if (request !== this.detailRequest) return;
        const language = this.translateLanguage;
        this.details.set(
          card.details?.[language as 'en' | 'fr'] ?? card.details?.en ?? card.details?.fr ?? null,
        );
        this.detailsLanguage.set(
          card.details?.[language as 'en' | 'fr'] ? language : card.details?.en ? 'en' : 'fr',
        );
      },
      error: () => {},
    });
  }
  energyIcon(type: string): string | null {
    const icons: Record<string, string> = {
      Grass: 'grass',
      Plante: 'grass',
      Fire: 'fire',
      Feu: 'fire',
      Water: 'water',
      Eau: 'water',
      Lightning: 'electric',
      Électrique: 'electric',
      Psychic: 'psychic',
      Psy: 'psychic',
      Fighting: 'fighting',
      Combat: 'fighting',
      Darkness: 'dark',
      Obscurité: 'dark',
      Metal: 'steel',
      Métal: 'steel',
      Fairy: 'fairy',
      Fée: 'fairy',
      Dragon: 'dragon',
      Colorless: 'normal',
      Incolore: 'normal',
    };
    return icons[type] ? `/energy-icons/${icons[type]}.png` : null;
  }
  get availableVariantTypes(): VariantType[] {
    return this.availableVariants().map((v) => v.variant_type);
  }
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['card']) {
      this.loadAvailableVariants();
      this.loadDeckUsage();
      this.loadDetails();
    }
    if (changes['card'] || changes['initialVariantType']) {
      this.selectedVariantType.set(this.initialVariantType ?? 'standard');
    }
  }
  private loadDeckUsage(): void {
    this.deckUsage.set(null);
    const catalogId = this.collectionCard?.catalog_id ?? this.card.id;
    this.catalogService.getDeckUsage(catalogId).subscribe((usage) => {
      this.deckUsage.set(usage);
    });
  }
  private loadAvailableVariants(): void {
    if (!this.collectionCard) {
      // A CardCatalogEntry already carries its full card_catalog_variants
      // list -- no extra fetch needed, unlike Card.variants below (owned
      // rows only).
      this.availableVariants.set((this.card as CardCatalogEntry).variants);
      return;
    }
    this.catalogService.getCardVariants(this.collectionCard.catalog_id).subscribe((variants) => {
      this.availableVariants.set(variants);
    });
  }
  selectVariant(variantType: VariantType): void {
    this.selectedVariantType.set(variantType);
  }
  /** The card's own standard-print image, independent of `imageUrl` (which
   * a host may have swapped to a matched variant's scan, e.g. Collection's
   * active owned-variant filter -- see features.md's "Search & filter the
   * collection"). Used for the 'standard' thumbnail itself, so it doesn't
   * end up showing the same art as a non-standard variant thumbnail. */
  private get standardImageUrl(): string {
    return this.catalogService.imageUrl(this.card.image_path);
  }
  /** Resolves one variant's own image, preferring the account's language
   * (same pokecardex FR/US fallback rule used across Browse/Collection/Set
   * detail), falling back to the standard print's image when the variant
   * has no scan of its own yet (e.g. 'standard' itself, or a variant not
   * scraped yet). */
  variantImageUrl(variant: CardCatalogVariant): string {
    if (variant.variant_type === 'standard') {
      return this.standardImageUrl;
    }
    const preferred =
      this.translate.currentLang() === 'fr' ? variant.image_path_fr : variant.image_path_us;
    const path = preferred ?? variant.image_path_fr ?? variant.image_path_us;
    return path ? this.catalogService.variantImageUrl(path) : this.standardImageUrl;
  }
  get displayedImageUrl(): string {
    const variant = this.availableVariants().find(
      (v) => v.variant_type === this.selectedVariantType(),
    );
    return variant ? this.variantImageUrl(variant) : this.imageUrl;
  }
  supertypeKey(value: string | null | undefined): string {
    return supertypeKeyFor(value);
  }
  get collectionCard(): Card | null {
    return 'quantity' in this.card ? (this.card as Card) : null;
  }
  get tcgplayerLine(): string {
    const c = this.card as CardCatalogEntry | Card;
    const qty = this.collectionCard?.quantity ?? 1;
    return `${qty} ${c.name} ${c.set_code} ${c.card_number}`;
  }
  get cardmarketUrl(): string {
    return `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(this.card.name)}`;
  }
  startEdit(): void {
    this.editing.set(true);
    this.editName.set(this.card.name);
  }
  cancelEdit(): void {
    this.editing.set(false);
  }
  variantLabel(variantType: VariantType): string {
    return VARIANT_LABELS[variantType];
  }
  /** This variant's owned quantity, 0 if not owned at all. */
  variantQuantity(variantType: VariantType): number {
    return this.collectionCard?.variants.find((v) => v.variant_type === variantType)?.quantity ?? 0;
  }
  stepVariantQuantity(variantType: VariantType, delta: number): void {
    const next = this.variantQuantity(variantType) + delta;
    if (next < 0) {
      return;
    }
    this.saveQuantity.emit({ variantType, quantity: next });
  }
  setVariantQuantity(variantType: VariantType, value: string): void {
    const next = Number(value);
    if (!Number.isFinite(next) || next < 0) {
      return;
    }
    this.saveQuantity.emit({ variantType, quantity: next });
  }
  confirmSave(): void {
    const trimmed = this.editName().trim();
    if (!trimmed) {
      return;
    }
    this.saveName.emit(trimmed);
    this.editing.set(false);
  }
  confirmDelete(): void {
    this.deleteCard.emit();
  }
  copyTcgLine(): void {
    navigator.clipboard.writeText(this.tcgplayerLine).then(
      () => this.toastService.show(this.translate.instant('cardDetail.copiedLine')),
      () => this.toastService.show(this.translate.instant('cardDetail.copyFailed'), 'error'),
    );
  }
}
