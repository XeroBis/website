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
