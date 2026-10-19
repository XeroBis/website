"""Tables in the `cards` schema (see data-model.md `cards`).

A shared catalog (`card_catalog` + the print variants each card comes in),
then everything personal: the collection (`cards` + a quantity per owned
variant), decks, upgrade drafts, purchases, purchase lists, share links
and shopping lists, each scoped to a `core.users` row. Combats are the one
shared log between users.
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base
from core.models import User
from domains.cards.variant_order import variant_order_expr

SCHEMA = {"schema": "cards"}
DECK_TYPES = ("normal", "phantom")
COLLECTION_ACTIONS = ("added", "increased", "decreased", "removed")
COLLECTION_SOURCES = ("manual", "import", "purchase")
COMBAT_SIDES = ("a", "b")


def _user_fk(**kwargs):
    return mapped_column(ForeignKey("core.users.id", ondelete="CASCADE"), **kwargs)


def _created_at():
    return mapped_column(DateTime(timezone=True), server_default=func.now())


# ── catalog ──────────────────────────────────────────────────────────────────


class CardCatalog(Base):
    """One card slot of a set, imported from the saved pokecardex HTML (see
    domains/cards/source/). Reference data: only `name` is editable (admin
    correction of a parsing mistake)."""

    __tablename__ = "card_catalog"
    __table_args__ = (
        # Trigram index on the punctuation-stripped name the catalog search
        # filters with a leading-wildcard ILIKE (needs `pg_trgm`, created by
        # the migration).
        Index(
            "ix_card_catalog_stripped_name_trgm",
            text(
                "replace(replace(replace(replace(name, '’', ''), '''', ''), '.', ''), ':', '') gin_trgm_ops"
            ),
            postgresql_using="gin",
        ),
        SCHEMA,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # English name; `display_name` is the French one (falls back to `name`).
    name: Mapped[str] = mapped_column(Text, index=True)
    display_name: Mapped[str] = mapped_column(Text, index=True)
    # The source folder the set came from (e.g. "Scarlet & Violet"): the
    # Sets page grouping and the first segment of every image path.
    series: Mapped[str | None] = mapped_column(Text)
    set_name: Mapped[str] = mapped_column(Text)
    set_name_fr: Mapped[str | None] = mapped_column(Text)
    set_code: Mapped[str] = mapped_column(Text, index=True)
    # Not unique within a set (some Energy/promo numbers repeat).
    card_number: Mapped[str] = mapped_column(Text)
    # TCGdex card text, {"en": {...}, "fr": {...}}.
    details: Mapped[dict | None] = mapped_column(JSON)
    # Relative to CARDS_DATA_DIR. The English scan, and the identity
    # collection export/import matches by.
    image_path: Mapped[str] = mapped_column(Text, unique=True)
    image_path_fr: Mapped[str | None] = mapped_column(Text)
    supertype: Mapped[str | None] = mapped_column(Text, index=True)
    # The CDN URL of the English standard scan, also the identity HTML
    # import reconciles a renumbered row by.
    source_url: Mapped[str | None] = mapped_column(Text)
    rarity: Mapped[str | None] = mapped_column(Text, index=True)
    # Set-level facts, denormalized onto each card of the set.
    card_count: Mapped[int | None]
    release_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = _created_at()

    variants: Mapped[list[CardCatalogVariant]] = relationship(
        back_populates="catalog_card",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by=lambda: variant_order_expr(CardCatalogVariant.variant_type),
    )


class CardCatalogVariant(Base):
    """A print variant a catalog card comes in (`standard` always, plus
    reverse, ball patterns, stamps, …), with its own scans."""

    __tablename__ = "card_catalog_variants"
    __table_args__ = (UniqueConstraint("card_catalog_id", "variant_type"), SCHEMA)

    id: Mapped[int] = mapped_column(primary_key=True)
    card_catalog_id: Mapped[int] = mapped_column(
        ForeignKey("cards.card_catalog.id", ondelete="CASCADE")
    )
    variant_type: Mapped[str] = mapped_column(Text)
    source_url_en: Mapped[str | None] = mapped_column(Text)
    source_url_fr: Mapped[str | None] = mapped_column(Text)
    # Always null for `standard`, whose scans are on card_catalog.
    image_path_fr: Mapped[str | None] = mapped_column(Text)
    image_path_us: Mapped[str | None] = mapped_column(Text)

    catalog_card: Mapped[CardCatalog] = relationship(back_populates="variants")


# ── collection ───────────────────────────────────────────────────────────────


class Card(Base):
    """A catalog card in a user's collection. Exists only while one of its
    variant quantities does."""

    __tablename__ = "cards"
    __table_args__ = (UniqueConstraint("user_id", "catalog_id"), SCHEMA)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _user_fk()
    catalog_id: Mapped[int] = mapped_column(ForeignKey("cards.card_catalog.id"))
    created_at: Mapped[datetime] = _created_at()

    catalog_card: Mapped[CardCatalog] = relationship()
    deck_cards: Mapped[list[DeckCard]] = relationship(
        back_populates="card", cascade="all, delete-orphan"
    )
    variant_quantities: Mapped[list[CardVariantQuantity]] = relationship(
        back_populates="card",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by=lambda: variant_order_expr(CardVariantQuantity.variant_type),
    )


class CardVariantQuantity(Base):
    """Copies owned of one print variant; a variant at 0 is deleted."""

    __tablename__ = "card_variant_quantities"
    __table_args__ = (
        UniqueConstraint("card_id", "variant_type"),
        CheckConstraint("quantity >= 1", name="quantity"),
        SCHEMA,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(
        ForeignKey("cards.cards.id", ondelete="CASCADE"), index=True
    )
    variant_type: Mapped[str] = mapped_column(Text)
    quantity: Mapped[int]
    created_at: Mapped[datetime] = _created_at()

    card: Mapped[Card] = relationship(back_populates="variant_quantities")


class CollectionHistory(Base):
    """Audit log of ownership changes, one row per (card, variant) change."""

    __tablename__ = "collection_history"
    __table_args__ = (
        CheckConstraint(f"action IN {COLLECTION_ACTIONS}", name="action"),
        CheckConstraint(f"source IN {COLLECTION_SOURCES}", name="source"),
        Index("ix_collection_history_user_id_created_at", "user_id", "created_at"),
        SCHEMA,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _user_fk()
    catalog_id: Mapped[int] = mapped_column(ForeignKey("cards.card_catalog.id"))
    variant_type: Mapped[str] = mapped_column(
        Text, default="standard", server_default="standard"
    )
    action: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text)
    old_quantity: Mapped[int | None]
    new_quantity: Mapped[int | None]
    created_at: Mapped[datetime] = _created_at()

    catalog_card: Mapped[CardCatalog] = relationship()


# ── decks ────────────────────────────────────────────────────────────────────


class Deck(Base):
    __tablename__ = "decks"
    __table_args__ = (
        UniqueConstraint("user_id", "name"),
        CheckConstraint(f"deck_type IN {DECK_TYPES}", name="deck_type"),
        SCHEMA,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _user_fk()
    name: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    # Set at creation only.
    deck_type: Mapped[str] = mapped_column(
        Text, default="normal", server_default="normal"
    )
    # Display tag, recomputed after every change to the deck's cards.
    has_wdc_cards: Mapped[bool] = mapped_column(default=False, server_default="false")
    created_at: Mapped[datetime] = _created_at()

    deck_cards: Mapped[list[DeckCard]] = relationship(
        back_populates="deck", cascade="all, delete-orphan", passive_deletes=True
    )
    deck_history: Mapped[list[DeckHistory]] = relationship(
        back_populates="deck", cascade="all, delete-orphan", passive_deletes=True
    )
    upgrade_drafts: Mapped[list[DeckUpgradeDraft]] = relationship(
        back_populates="deck", cascade="all, delete-orphan", passive_deletes=True
    )
    owner: Mapped[User] = relationship()


class DeckCard(Base):
    """A normal deck's row points at an owned `cards` row (`card_id`); a
    phantom deck's at the catalog (`catalog_id`), so it can list cards owned
    zero times. Exactly one of the two is set."""

    __tablename__ = "deck_cards"
    __table_args__ = (
        # One row per (deck, card, print variant).
        Index(
            "uq_deck_cards_deck_id_card_id_variant",
            "deck_id",
            "card_id",
            "variant_type",
            unique=True,
            postgresql_where=text("card_id IS NOT NULL"),
        ),
        Index(
            "uq_deck_cards_deck_id_catalog_id_variant",
            "deck_id",
            "catalog_id",
            "variant_type",
            unique=True,
            postgresql_where=text("catalog_id IS NOT NULL"),
        ),
        # At most one row per poster slot (0–2) of a deck.
        Index(
            "uq_deck_cards_deck_id_poster_slot",
            "deck_id",
            "poster_slot",
            unique=True,
            postgresql_where=text("poster_slot IS NOT NULL"),
        ),
        # The collection's allocated-per-card lookups filter by card_id alone.
        Index("ix_deck_cards_card_id", "card_id"),
        CheckConstraint(
            "(card_id IS NOT NULL) != (catalog_id IS NOT NULL)",
            name="card_xor_catalog",
        ),
        CheckConstraint("quantity_in_deck >= 1", name="quantity_in_deck"),
        CheckConstraint("poster_slot BETWEEN 0 AND 2", name="poster_slot"),
        SCHEMA,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    deck_id: Mapped[int] = mapped_column(
        ForeignKey("cards.decks.id", ondelete="CASCADE")
    )
    # Cascades so deleting an account works; the API itself refuses to
    # delete a card that is in a deck.
    card_id: Mapped[int | None] = mapped_column(
        ForeignKey("cards.cards.id", ondelete="CASCADE")
    )
    catalog_id: Mapped[int | None] = mapped_column(ForeignKey("cards.card_catalog.id"))
    variant_type: Mapped[str] = mapped_column(
        Text, default="standard", server_default="standard"
    )
    quantity_in_deck: Mapped[int] = mapped_column(default=1)
    poster_slot: Mapped[int | None] = mapped_column(SmallInteger)

    deck: Mapped[Deck] = relationship(back_populates="deck_cards")
    card: Mapped[Card | None] = relationship(back_populates="deck_cards")
    catalog_card: Mapped[CardCatalog | None] = relationship()


class DeckHistory(Base):
    __tablename__ = "deck_history"
    __table_args__ = SCHEMA

    id: Mapped[int] = mapped_column(primary_key=True)
    deck_id: Mapped[int] = mapped_column(
        ForeignKey("cards.decks.id", ondelete="CASCADE"), index=True
    )
    action: Mapped[str] = mapped_column(Text)
    detail: Mapped[str | None] = mapped_column(Text)
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    variant_type: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()

    deck: Mapped[Deck] = relationship(back_populates="deck_history")


class DeckUpgradeDraft(Base):
    """A saved "what if" diff against a normal deck (normal-only is checked
    by the API)."""

    __tablename__ = "deck_upgrade_drafts"
    __table_args__ = (UniqueConstraint("deck_id", "name"), SCHEMA)

    id: Mapped[int] = mapped_column(primary_key=True)
    deck_id: Mapped[int] = mapped_column(
        ForeignKey("cards.decks.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    deck: Mapped[Deck] = relationship(back_populates="upgrade_drafts")
    entries: Mapped[list[DeckUpgradeDraftCard]] = relationship(
        back_populates="draft", cascade="all, delete-orphan", passive_deletes=True
    )


class DeckUpgradeDraftCard(Base):
    """One proposed change: a signed, nonzero delta on the deck's quantity of
    that card and variant."""

    __tablename__ = "deck_upgrade_draft_cards"
    __table_args__ = (
        UniqueConstraint("draft_id", "catalog_id", "variant_type"),
        CheckConstraint("quantity_delta != 0", name="quantity_delta"),
        SCHEMA,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    draft_id: Mapped[int] = mapped_column(
        ForeignKey("cards.deck_upgrade_drafts.id", ondelete="CASCADE")
    )
    catalog_id: Mapped[int] = mapped_column(ForeignKey("cards.card_catalog.id"))
    variant_type: Mapped[str] = mapped_column(
        Text, default="standard", server_default="standard"
    )
    quantity_delta: Mapped[int]

    draft: Mapped[DeckUpgradeDraft] = relationship(back_populates="entries")
    catalog_card: Mapped[CardCatalog] = relationship()


# ── combats ──────────────────────────────────────────────────────────────────


class Combat(Base):
    """A game between two decks, shared between cards users. Each side's card
    list and deck name are frozen when the deck is set, so the log survives
    the deck being edited or deleted."""

    __tablename__ = "combats"
    __table_args__ = (
        CheckConstraint(f"winner IN {COMBAT_SIDES}", name="winner"),
        CheckConstraint("loser_score BETWEEN 1 AND 6", name="loser_score"),
        SCHEMA,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    deck_a_id: Mapped[int | None] = mapped_column(
        ForeignKey("cards.decks.id", ondelete="SET NULL")
    )
    player_a_id: Mapped[int] = _user_fk()
    deck_b_id: Mapped[int | None] = mapped_column(
        ForeignKey("cards.decks.id", ondelete="SET NULL")
    )
    player_b_id: Mapped[int] = _user_fk()
    winner: Mapped[str] = mapped_column(Text)
    # Prizes the loser still had to take (the winner's is always 0).
    loser_score: Mapped[int]
    # Date only (midnight UTC).
    played_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_at: Mapped[datetime] = _created_at()
    deck_a_snapshot: Mapped[list] = mapped_column(JSON)
    deck_b_snapshot: Mapped[list] = mapped_column(JSON)
    deck_a_name_snapshot: Mapped[str] = mapped_column(Text)
    deck_b_name_snapshot: Mapped[str] = mapped_column(Text)

    deck_a: Mapped[Deck | None] = relationship(foreign_keys=[deck_a_id])
    deck_b: Mapped[Deck | None] = relationship(foreign_keys=[deck_b_id])
    player_a: Mapped[User] = relationship(foreign_keys=[player_a_id])
    player_b: Mapped[User] = relationship(foreign_keys=[player_b_id])


# ── purchases, shares, shopping lists ────────────────────────────────────────


class Purchase(Base):
    """ "What I Paid": a private spend log, not linked to specific cards."""

    __tablename__ = "purchases"
    __table_args__ = (
        CheckConstraint("price >= 0", name="price"),
        CheckConstraint("quantity >= 1", name="quantity"),
        SCHEMA,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _user_fk(index=True)
    product_name: Mapped[str] = mapped_column(Text)
    # The entry's total, not a unit price; single fixed currency.
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    quantity: Mapped[int] = mapped_column(default=1)
    # Date only (midnight UTC).
    purchased_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    source: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    # Informational set codes, not FKs.
    sets: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default=text("'{}'")
    )
    created_at: Mapped[datetime] = _created_at()


class SetShare(Base):
    """A public, time-limited, read-only link to one set of a user's
    collection. Ownership is recomputed on every read."""

    __tablename__ = "set_shares"
    __table_args__ = SCHEMA

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _user_fk(index=True)
    set_code: Mapped[str] = mapped_column(Text)
    # secrets.token_urlsafe(24): the only identifier in the public URL.
    token: Mapped[str] = mapped_column(Text, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()

    owner: Mapped[User] = relationship()


class ShoppingList(Base):
    """A shopping-round checklist from a pasted decklist, deliberately not
    linked to the real collection."""

    __tablename__ = "shopping_lists"
    __table_args__ = (UniqueConstraint("user_id", "name"), SCHEMA)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _user_fk()
    name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    cards: Mapped[list[ShoppingListCard]] = relationship(
        back_populates="shopping_list",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ShoppingListCard.id",
    )


class ShoppingListCard(Base):
    """`quantity_owned` is a manual "secured so far" tally."""

    __tablename__ = "shopping_list_cards"
    __table_args__ = (
        UniqueConstraint("shopping_list_id", "catalog_id"),
        CheckConstraint(
            "quantity_owned BETWEEN 0 AND quantity_needed", name="quantity_owned"
        ),
        SCHEMA,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    shopping_list_id: Mapped[int] = mapped_column(
        ForeignKey("cards.shopping_lists.id", ondelete="CASCADE")
    )
    catalog_id: Mapped[int] = mapped_column(ForeignKey("cards.card_catalog.id"))
    quantity_needed: Mapped[int]
    quantity_owned: Mapped[int] = mapped_column(default=0, server_default="0")
    created_at: Mapped[datetime] = _created_at()

    shopping_list: Mapped[ShoppingList] = relationship(back_populates="cards")
    catalog_card: Mapped[CardCatalog] = relationship()


# ── purchase lists ───────────────────────────────────────────────────────────


class PurchaseList(Base):
    """A bought order not yet arrived ("Liste d'achat"): its cards count as
    owned in the missing views until it is received (`received_at` set),
    which adds them to the collection."""

    __tablename__ = "purchase_lists"
    __table_args__ = (UniqueConstraint("user_id", "name"), SCHEMA)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _user_fk(index=True)
    name: Mapped[str] = mapped_column(Text)
    # The What I Paid entry made by the import; kept when the list goes.
    purchase_id: Mapped[int | None] = mapped_column(
        ForeignKey("cards.purchases.id", ondelete="SET NULL")
    )
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    purchase: Mapped[Purchase | None] = relationship()
    cards: Mapped[list[PurchaseListCard]] = relationship(
        back_populates="purchase_list",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="PurchaseListCard.id",
    )


class PurchaseListCard(Base):
    """Copies of one print on a purchase list."""

    __tablename__ = "purchase_list_cards"
    __table_args__ = (
        UniqueConstraint("purchase_list_id", "catalog_id", "variant_type"),
        CheckConstraint("quantity >= 1", name="quantity"),
        SCHEMA,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    purchase_list_id: Mapped[int] = mapped_column(
        ForeignKey("cards.purchase_lists.id", ondelete="CASCADE"), index=True
    )
    catalog_id: Mapped[int] = mapped_column(ForeignKey("cards.card_catalog.id"))
    variant_type: Mapped[str] = mapped_column(
        Text, default="standard", server_default="standard"
    )
    quantity: Mapped[int]
    created_at: Mapped[datetime] = _created_at()

    purchase_list: Mapped[PurchaseList] = relationship(back_populates="cards")
    catalog_card: Mapped[CardCatalog] = relationship()
