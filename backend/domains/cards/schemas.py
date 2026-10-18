"""Request and response bodies for `/api/cards`."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer

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
