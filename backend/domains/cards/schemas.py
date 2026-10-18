"""Request and response bodies for `/api/cards`."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

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
