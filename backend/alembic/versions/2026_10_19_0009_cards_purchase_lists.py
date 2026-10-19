"""cards purchase lists

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-19 13:24:45.462908

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "purchase_lists",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("purchase_id", sa.Integer(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["purchase_id"],
            ["cards.purchases.id"],
            name=op.f("fk_purchase_lists_purchase_id_purchases"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["core.users.id"],
            name=op.f("fk_purchase_lists_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_purchase_lists")),
        sa.UniqueConstraint("user_id", "name", name=op.f("uq_purchase_lists_user_id")),
        schema="cards",
    )
    op.create_index(
        op.f("ix_cards_purchase_lists_user_id"),
        "purchase_lists",
        ["user_id"],
        unique=False,
        schema="cards",
    )
    op.create_table(
        "purchase_list_cards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("purchase_list_id", sa.Integer(), nullable=False),
        sa.Column("catalog_id", sa.Integer(), nullable=False),
        sa.Column("variant_type", sa.Text(), server_default="standard", nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "quantity >= 1", name=op.f("ck_purchase_list_cards_quantity")
        ),
        sa.ForeignKeyConstraint(
            ["catalog_id"],
            ["cards.card_catalog.id"],
            name=op.f("fk_purchase_list_cards_catalog_id_card_catalog"),
        ),
        sa.ForeignKeyConstraint(
            ["purchase_list_id"],
            ["cards.purchase_lists.id"],
            name=op.f("fk_purchase_list_cards_purchase_list_id_purchase_lists"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_purchase_list_cards")),
        sa.UniqueConstraint(
            "purchase_list_id",
            "catalog_id",
            "variant_type",
            name=op.f("uq_purchase_list_cards_purchase_list_id"),
        ),
        schema="cards",
    )
    op.create_index(
        op.f("ix_cards_purchase_list_cards_purchase_list_id"),
        "purchase_list_cards",
        ["purchase_list_id"],
        unique=False,
        schema="cards",
    )
    _history_sources("'manual', 'import', 'purchase'")


def downgrade() -> None:
    op.execute(
        "UPDATE cards.collection_history SET source = 'manual'"
        " WHERE source = 'purchase'"
    )
    _history_sources("'manual', 'import'")
    op.drop_index(
        op.f("ix_cards_purchase_list_cards_purchase_list_id"),
        table_name="purchase_list_cards",
        schema="cards",
    )
    op.drop_table("purchase_list_cards", schema="cards")
    op.drop_index(
        op.f("ix_cards_purchase_lists_user_id"),
        table_name="purchase_lists",
        schema="cards",
    )
    op.drop_table("purchase_lists", schema="cards")


def _history_sources(sources: str) -> None:
    """collection_history.source also takes `purchase` (a received list)."""
    name = op.f("ck_collection_history_source")
    op.drop_constraint(name, "collection_history", schema="cards", type_="check")
    op.create_check_constraint(
        name, "collection_history", f"source IN ({sources})", schema="cards"
    )
