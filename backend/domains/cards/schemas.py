"""Request and response bodies for `/api/cards`."""

from datetime import UTC, date, datetime, time
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_validator,
    model_serializer,
)


def midnight_utc(value: date | datetime) -> datetime:
    """A day stored as midnight UTC; a datetime keeps its UTC date."""
    if isinstance(value, datetime):
        value = (value.astimezone(UTC) if value.tzinfo else value).date()
    return datetime.combine(value, time(), UTC)


def _trimmed(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("must not be blank")
    return value


def _trimmed_or_none(value: str | None) -> str | None:
    return (value or "").strip() or None


# A date (or a datetime, as in old export files), stored at midnight UTC.
Day = Annotated[datetime | date, AfterValidator(midnight_utc)]
Name = Annotated[str, AfterValidator(_trimmed)]
OptionalText = Annotated[str | None, AfterValidator(_trimmed_or_none)]

# ── catalog ──────────────────────────────────────────────────────────────────


class CatalogVariantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    variant_type: str
    image_path_fr: str | None = None
    image_path_us: str | None = None


class CatalogCardOut(BaseModel):
    """A catalog card; `name`, `set_name` and `image_path` are in the
    viewer's language (see display.py)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    set_name: str
    set_name_fr: str | None = None
    set_code: str
    card_number: str
    image_path: str
    source_url: str | None = None
    supertype: str | None = None
    rarity: str | None = None
    series: str | None = None
    card_count: int | None = None
    release_date: date | None = None
    details: dict | None = None
    created_at: datetime
    variants: list[CatalogVariantOut] = []


class CatalogPage(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[CatalogCardOut]


class CatalogNameUpdate(BaseModel):
    name: str = Field(min_length=1)


class SetOut(BaseModel):
    set_code: str
    set_name: str
    set_name_fr: str | None
    series: str | None
    series_display_name: str | None
    card_count: int | None
    release_date: date | None
    logo_path: str | None
    logo_path_fr: str | None
    symbol_path: str | None
    # Null when no card matches the completion selection.
    completion_percent: int | None


class MissingInterval(BaseModel):
    start_number: int
    end_number: int


class MissingSetIntervals(BaseModel):
    set_code: str
    set_name: str
    series: str | None
    symbol_path: str | None
    missing_count: int
    intervals: list[MissingInterval]
    # Per number: missing (anchor), owned (stop), other rarities (bridge).
    missing_numbers: list[int]
    owned_numbers: list[int]
    excluded_numbers: list[int]


class DeckUsage(BaseModel):
    deck_id: int
    deck_name: str
    quantity_in_deck: int


class CatalogDeckUsage(BaseModel):
    """The current user's normal decks holding owned copies, and phantom
    decks wanting the card (owned or not)."""

    allocated_decks: list[DeckUsage] = []
    phantom_decks: list[DeckUsage] = []


# ── collection ───────────────────────────────────────────────────────────────


class OwnedVariantOut(BaseModel):
    """Copies owned of one print, with that print's scans (from the catalog
    variant; null for `standard`, whose scan is the card's `image_path`)."""

    variant_type: str
    quantity: int
    image_path_fr: str | None = None
    image_path_us: str | None = None


class CardOut(BaseModel):
    """An owned card; `name`, `set_name` and `image_path` are in the viewer's
    language. `allocated` counts copies in normal decks, `available` is
    `quantity - allocated`, both also per print in `allocated_variants`.
    `decks` sums each deck's copies over prints."""

    id: int
    catalog_id: int
    variants: list[OwnedVariantOut]
    quantity: int
    created_at: datetime
    name: str
    set_name: str
    set_code: str
    card_number: str
    image_path: str
    supertype: str | None
    rarity: str | None
    series: str | None
    card_count: int | None
    release_date: date | None
    allocated: int
    allocated_variants: dict[str, int]
    available: int
    decks: list[DeckUsage]


class CardPage(BaseModel):
    """`total_quantity` sums the copies of every matching card (not just this
    page), `collection_total_quantity` those of the whole collection."""

    total: int
    page: int
    page_size: int
    total_quantity: int
    collection_total_quantity: int
    items: list[CardOut]


class SetOption(BaseModel):
    set_code: str
    set_name: str


class CollectionFilterOptions(BaseModel):
    """Over the whole collection, whatever the current filters."""

    sets: list[SetOption]
    rarities: list[str]
    owned_variant_types: list[str]


class CardAdd(BaseModel):
    catalog_id: int
    variant_type: str = "standard"
    quantity: int = Field(1, ge=1)
    # Add `quantity` of every print the card comes in instead.
    all_variants: bool = False


class CardBulkAdd(BaseModel):
    items: list[CardAdd] = Field(min_length=1)
    # Also put every added copy into this normal deck, in the same batch.
    deck_id: int | None = None


class CardQuantityUpdate(BaseModel):
    """An absolute quantity for one print; 0 removes the print (and the card
    with its last print)."""

    variant_type: str = "standard"
    quantity: int = Field(ge=0)


class CollectionHistoryOut(BaseModel):
    id: int
    catalog_id: int
    variant_type: str
    action: str
    source: str
    old_quantity: int | None
    new_quantity: int | None
    created_at: datetime
    name: str
    set_name: str
    image_path: str


class CollectionHistoryPage(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[CollectionHistoryOut]


class VariantQuantity(BaseModel):
    variant_type: str
    quantity: int = Field(ge=1)


class CollectionFileCard(BaseModel):
    """One card of `collection.json`, always with the English values.
    `image_path` is what an import matches by; the rest is informational
    (old exports also carry null `image_path_fr/us` on each variant, which
    are ignored)."""

    name: str | None = None
    set_name: str | None = None
    set_code: str | None = None
    card_number: str | None = None
    image_path: str = Field(min_length=1)
    variants: list[VariantQuantity] = Field(min_length=1)


class CollectionFile(BaseModel):
    cards: list[CollectionFileCard]


class CollectionImportResult(BaseModel):
    """Distinct cards touched, and the sum of their imported quantities."""

    imported: int
    imported_quantity: int


class CollectionWipeResult(BaseModel):
    deleted_cards: int
    deleted_decks: int


# ── decks ────────────────────────────────────────────────────────────────────


class DeckCreate(BaseModel):
    name: str
    description: str | None = None
    deck_type: Literal["normal", "phantom"] = "normal"
    # Optional TCGplayer/PTCGL or Cardmarket decklist to fill the deck with
    # (matched lines only, standard print).
    decklist_text: str | None = None


class DeckUpdate(BaseModel):
    """Omitted fields are left as they are."""

    name: str | None = None
    # null or blank clears it.
    description: str | None = None
    # Up to 3 distinct deck card ids of this deck, in slot order; [] clears.
    poster_card_ids: list[int] | None = Field(None, max_length=3)


class DeckCopy(BaseModel):
    name: str


class DeckCardOut(BaseModel):
    """One row of a deck: an owned card's print (normal deck, `card_id` set)
    or a wanted print (phantom deck, `card_id` null). Normal rows: `available`
    = copies of that print outside every normal deck, `owned` null. Phantom
    rows: `owned` = copies of that print owned, `available` = those not in a
    normal deck, `allocated_decks` = which normal decks hold them."""

    id: int
    card_id: int | None
    catalog_id: int
    variant_type: str
    quantity_in_deck: int
    poster_slot: int | None
    name: str
    set_name: str
    set_code: str
    card_number: str
    image_path: str
    supertype: str | None
    available: int
    owned: int | None = None
    allocated_decks: list[DeckUsage] = []


class DeckOut(BaseModel):
    id: int
    name: str
    description: str | None
    deck_type: str
    has_wdc_cards: bool
    created_at: datetime
    total_cards: int
    # By slot.
    poster_cards: list[DeckCardOut]


class DeckDetailOut(DeckOut):
    cards: list[DeckCardOut]


class DeckCardCreate(BaseModel):
    """A normal deck takes an owned `card_id`, a phantom deck a
    `catalog_id`."""

    card_id: int | None = None
    catalog_id: int | None = None
    variant_type: str = "standard"
    quantity_in_deck: int = Field(1, ge=1)


class DeckCardUpdate(BaseModel):
    quantity_in_deck: int = Field(ge=1)


class DeckBulkAddItem(BaseModel):
    card_id: int
    variant_type: str = "standard"
    # Add `quantity_in_deck` of every print of the card instead.
    all_variants: bool = False
    quantity_in_deck: int = Field(1, ge=1)


class DeckBulkAdd(BaseModel):
    items: list[DeckBulkAddItem] = Field(min_length=1)


class DecklistText(BaseModel):
    decklist_text: str


class DeckHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    deck_id: int
    action: str
    detail: str | None
    old_value: str | None
    new_value: str | None
    variant_type: str | None
    created_at: datetime


class DeckHistoryPage(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[DeckHistoryOut]


class DeckWipeResult(BaseModel):
    deleted_decks: int


# ── deck files (export / import) ─────────────────────────────────────────────


class DeckFileCard(BaseModel):
    """A card of a deck file, identified by set code and number (`name` is
    informational; old files' extra `set_name`/`image_path` are ignored)."""

    name: str | None = None
    set_code: str = Field(min_length=1)
    card_number: str = Field(min_length=1)
    variant_type: str = "standard"
    quantity_in_deck: int = Field(ge=1)


class DeckFileDraftEntry(BaseModel):
    name: str | None = None
    set_code: str = Field(min_length=1)
    card_number: str = Field(min_length=1)
    variant_type: str = "standard"
    quantity_delta: int

    @field_validator("quantity_delta")
    @classmethod
    def _nonzero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("must be nonzero")
        return value


class DeckFileDraft(BaseModel):
    name: str = Field(min_length=1)
    entries: list[DeckFileDraftEntry] = []


class DeckFile(BaseModel):
    """One deck of `decks.json` / a single deck export. `deck_type` other
    than `phantom` (missing in old files, or an old `wdc`) imports as
    normal. `drafts` is left out of exports when empty."""

    name: str = Field(min_length=1)
    description: str | None = None
    deck_type: str | None = "normal"
    cards: list[DeckFileCard] = []
    drafts: list[DeckFileDraft] | None = None

    @model_serializer(mode="wrap")
    def _without_empty_drafts(self, handler):
        data = handler(self)
        if not data.get("drafts"):
            data.pop("drafts", None)
        return data


class DecksFile(BaseModel):
    decks: list[DeckFile]


# ── upgrade drafts ───────────────────────────────────────────────────────────


class DraftCreate(BaseModel):
    name: str
    # A decklist or a deck file's JSON to diff the deck against.
    decklist_text: str | None = None


class DraftRename(BaseModel):
    name: str


class DraftEntryUpdate(BaseModel):
    quantity_delta: int

    @field_validator("quantity_delta")
    @classmethod
    def _nonzero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("must be nonzero")
        return value


class DraftOut(BaseModel):
    id: int
    deck_id: int
    name: str
    created_at: datetime
    updated_at: datetime
    entry_count: int


class DraftEntryOut(BaseModel):
    """`available` already keeps one copy back for the binder."""

    catalog_id: int
    variant_type: str
    name: str
    set_name: str
    image_path: str
    supertype: str | None
    baseline_quantity: int
    quantity_delta: int
    result_quantity: int
    owned: int
    available: int


class DraftResultCard(BaseModel):
    catalog_id: int
    variant_type: str
    name: str
    set_name: str
    image_path: str
    supertype: str | None
    quantity_in_deck: int


class DraftDetailOut(BaseModel):
    """`can_apply`: some entry, a result of ≤ 60 cards, and every proposed
    addition covered by `available`."""

    id: int
    deck_id: int
    name: str
    created_at: datetime
    updated_at: datetime
    current_cards: list[DeckCardOut]
    entries: list[DraftEntryOut]
    result_cards: list[DraftResultCard]
    result_total: int
    can_apply: bool


class DraftPickerItem(BaseModel):
    """`result_total`: the deck's card count with the draft applied."""

    id: int
    deck_id: int
    deck_name: str
    name: str
    updated_at: datetime
    result_total: int


class DraftIds(BaseModel):
    draft_ids: list[int] = Field(min_length=1)


class SetCodes(BaseModel):
    set_codes: list[str] = Field(min_length=1)


class SetMissingOut(BaseModel):
    set_code: str
    missing: int
    total: int
    completion_percent: int


# ── decklist converter ───────────────────────────────────────────────────────


class DecklistConvert(BaseModel):
    text: str
    # Cardmarket output only: the `(expansion)` suffix.
    include_sets: bool = True


class DecklistConvertEntry(BaseModel):
    """A parsed line; card fields (display, in the viewer's language) are
    null when unmatched, `name` is then the parsed name."""

    quantity: int
    matched: bool
    name: str
    set_name: str | None = None
    set_code: str | None = None
    card_number: str | None = None
    image_path: str | None = None
    catalog_id: int | None = None


class DecklistConvertOut(BaseModel):
    detected_format: Literal["tcgplayer", "cardmarket"] | None
    converted_text: str
    entries: list[DecklistConvertEntry]


# ── users ────────────────────────────────────────────────────────────────────


class CardsUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    pseudo: str


# ── combats ──────────────────────────────────────────────────────────────────


class CombatDeckOption(BaseModel):
    """Any cards user's normal deck, for the combat deck pickers: name, tag
    and owner only, never its cards."""

    id: int
    name: str
    deck_type: str
    has_wdc_cards: bool
    owner_id: int
    owner_label: str


class CombatSnapshotCard(BaseModel):
    """One row of a side's deck when it was set, English values (`card_id`
    is the owned card then; it means nothing after an import)."""

    card_id: int | None = None
    variant_type: str = "standard"
    quantity_in_deck: int
    name: str
    set_name: str
    image_path: str
    supertype: str | None = None


class CombatCreate(BaseModel):
    deck_a_id: int
    player_a_id: int
    deck_b_id: int
    player_b_id: int
    winner: Literal["a", "b"]
    loser_score: int = Field(ge=1, le=6)
    # Today when left out.
    played_at: Day | None = None


class CombatUpdate(BaseModel):
    """Every field. A side keeps its snapshot while its deck is unchanged; a
    null deck is only allowed for a side whose deck was deleted."""

    deck_a_id: int | None
    player_a_id: int
    deck_b_id: int | None
    player_b_id: int
    winner: Literal["a", "b"]
    loser_score: int = Field(ge=1, le=6)
    played_at: Day


class CombatOut(BaseModel):
    """`deck_*_name`: the deck's current name, or the snapshot's once it is
    deleted. Snapshot cards are in the viewer's language."""

    id: int
    deck_a_id: int | None
    deck_a_name: str
    player_a_id: int
    player_a_pseudo: str
    deck_b_id: int | None
    deck_b_name: str
    player_b_id: int
    player_b_pseudo: str
    winner: Literal["a", "b"]
    loser_score: int
    played_at: datetime
    created_at: datetime
    deck_a_snapshot: list[CombatSnapshotCard]
    deck_b_snapshot: list[CombatSnapshotCard]


class CombatFileEntry(BaseModel):
    """One combat of `combats.json`. Decks are matched by name and owner
    email (name only when the email is missing), players by email; the
    pseudos are informational. A missing snapshot is taken from the matched
    deck."""

    deck_a_name: str = Field(min_length=1)
    deck_a_owner_email: str | None = None
    player_a_email: str = Field(min_length=1)
    player_a_pseudo: str | None = None
    deck_b_name: str = Field(min_length=1)
    deck_b_owner_email: str | None = None
    player_b_email: str = Field(min_length=1)
    player_b_pseudo: str | None = None
    winner: Literal["a", "b"]
    loser_score: int = Field(ge=1, le=6)
    played_at: Day
    deck_a_snapshot: list[CombatSnapshotCard] | None = None
    deck_b_snapshot: list[CombatSnapshotCard] | None = None


class CombatsFile(BaseModel):
    combats: list[CombatFileEntry]


class CombatWipeResult(BaseModel):
    deleted_combats: int


# ── purchases ────────────────────────────────────────────────────────────────


class PurchaseIn(BaseModel):
    product_name: Name
    # The entry's total, not a unit price.
    price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    # Informational.
    quantity: int = Field(1, ge=1)
    # Today when left out.
    purchased_at: Day | None = None
    source: OptionalText = None
    description: OptionalText = None
    # Set codes, informational (not checked against the catalog).
    sets: list[str] = []

    @field_validator("sets")
    @classmethod
    def _clean_sets(cls, sets: list[str]) -> list[str]:
        """Trimmed, blanks and repeats dropped, order kept."""
        return list(dict.fromkeys(code.strip() for code in sets if code.strip()))


class PurchaseUpdate(PurchaseIn):
    quantity: int = Field(ge=1)
    purchased_at: Day


class PurchaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_name: str
    price: Decimal
    quantity: int
    purchased_at: datetime
    source: str | None
    description: str | None
    sets: list[str]
    created_at: datetime


class PurchaseFileEntry(PurchaseIn):
    purchased_at: Day


class PurchasesFile(BaseModel):
    purchases: list[PurchaseFileEntry]


class PurchaseWipeResult(BaseModel):
    deleted_purchases: int


# ── purchase lists ───────────────────────────────────────────────────────────


class CardmarketOrder(BaseModel):
    # The saved order page (its article table), as text.
    html: str


class CardmarketImport(CardmarketOrder):
    name: Name
    # The order's total (shipping included if wanted).
    price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)


class CardmarketLineOut(BaseModel):
    """One article row; the catalog fields only when `matched`. `label` is
    Cardmarket's name, `name` the catalog's in the viewer's language."""

    quantity: int
    unit_price: Decimal
    label: str
    matched: bool
    reason: str | None = None
    catalog_id: int | None = None
    variant_type: str | None = None
    name: str | None = None
    set_code: str | None = None
    card_number: str | None = None
    image_path: str | None = None


class CardmarketPreview(BaseModel):
    total_quantity: int
    total_price: Decimal
    set_codes: list[str]
    lines: list[CardmarketLineOut]


class PurchaseListCreate(BaseModel):
    """An empty list, its total optional."""

    name: Name
    price: Decimal | None = Field(None, ge=0, max_digits=10, decimal_places=2)


class PurchaseListRename(BaseModel):
    name: Name


class PurchaseListCardAdd(BaseModel):
    catalog_id: int
    variant_type: str = "standard"
    quantity: int = Field(1, ge=1)


class PurchaseListCardUpdate(BaseModel):
    variant_type: str
    quantity: int = Field(ge=1)


class PurchaseListCardOut(BaseModel):
    """`name`, `set_name` and `image_path` in the viewer's language;
    `variants`: the prints the card comes in."""

    id: int
    catalog_id: int
    variant_type: str
    quantity: int
    name: str
    set_name: str
    set_code: str
    card_number: str
    image_path: str
    supertype: str | None
    rarity: str | None
    variants: list[str]


class PurchaseListOut(BaseModel):
    """`total_cards`: lines; `price`: the total entered, if any."""

    id: int
    name: str
    created_at: datetime
    updated_at: datetime
    received_at: datetime | None
    price: Decimal | None
    total_cards: int
    total_quantity: int


class PurchaseListDetailOut(PurchaseListOut):
    cards: list[PurchaseListCardOut]


class UnmatchedArticle(BaseModel):
    quantity: int
    label: str
    reason: str


class CardmarketImportResult(BaseModel):
    purchase_list: PurchaseListDetailOut
    unmatched: list[UnmatchedArticle]


class IncomingPrint(BaseModel):
    catalog_id: int
    variant_type: str
    quantity: int


# ── shares ───────────────────────────────────────────────────────────────────


class ShareCreate(BaseModel):
    set_code: str
    duration_days: Literal[1, 3, 7, 30]


class ShareOut(BaseModel):
    """`set_name` in the viewer's language."""

    id: int
    set_code: str
    set_name: str | None
    token: str
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None

    @computed_field
    @property
    def status(self) -> Literal["active", "expired", "revoked"]:
        if self.revoked_at is not None:
            return "revoked"
        if self.expires_at <= datetime.now(UTC):
            return "expired"
        return "active"


class SharedSetCardOut(BaseModel):
    """English values. `variants`: the owner's copies per print;
    `print_variants`: every print the card comes in."""

    id: int
    name: str
    set_code: str
    set_name: str
    card_number: str
    image_path: str
    rarity: str | None
    supertype: str | None
    quantity_owned: int
    variants: list[OwnedVariantOut]
    print_variants: list[CatalogVariantOut]


class SharedSetOut(BaseModel):
    """The public page of a share: one set, nothing about its owner. Images
    go through the share's own `/images/`, `/logo` and `/symbol` routes."""

    set_code: str
    set_name: str
    series: str | None
    card_count: int | None
    release_date: date | None
    expires_at: datetime
    cards: list[SharedSetCardOut]


# ── catalog management (admin) ───────────────────────────────────────────────


class CatalogStats(BaseModel):
    total_cards: int
    total_sets: int
    distinct_card_names: int
    # Catalog prints per variant type, `standard` included.
    variant_counts: dict[str, int]


class JobStarted(BaseModel):
    status: Literal["started"] = "started"


class JobStatus(BaseModel):
    """A catalog job's in-memory state (refresh/jobs.py)."""

    status: Literal["idle", "running", "done", "error"]
    step: str | None
    step_label: str | None
    step_index: int
    total_steps: int
    percent: int
    sub_done: int
    sub_total: int
    result: dict
    error: str | None
    last_run_at: str | None
    last_run_result: dict | None


class CatalogFileCard(BaseModel):
    """One card of `cards_metadata.json`, the old app's field names kept so its
    files import unchanged (`pokemon_name` = `name`, `local_path` =
    `image_path`, `card_page_url` = `source_url`)."""

    pokemon_name: str
    display_name: str | None = None
    details: dict | None = None
    set_name: str
    set_name_fr: str | None = None
    set_code: str
    card_number: str
    local_path: str
    card_page_url: str | None = None
    supertype: str | None = None
    rarity: str | None = None
    series: str | None = None
    card_count: int | None = None
    release_date: date | None = None
    image_path_fr: str | None = None
    variants: list[CatalogVariantOut] = []


class CatalogFile(BaseModel):
    total_cards: int
    cards: list[CatalogFileCard]


class CatalogImportResult(BaseModel):
    created: int
    updated: int
