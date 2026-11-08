"""cards sale lists

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-08 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sale_lists",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("sold_at", sa.DateTime(timezone=True), nullable=True),
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
            ["user_id"],
            ["core.users.id"],
            name=op.f("fk_sale_lists_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sale_lists")),
        sa.UniqueConstraint("user_id", "name", name=op.f("uq_sale_lists_user_id")),
        schema="cards",
    )
    op.create_index(
        op.f("ix_cards_sale_lists_user_id"),
        "sale_lists",
        ["user_id"],
        unique=False,
        schema="cards",
    )
    op.create_table(
        "sale_list_cards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sale_list_id", sa.Integer(), nullable=False),
        sa.Column("catalog_id", sa.Integer(), nullable=False),
        sa.Column("variant_type", sa.Text(), server_default="standard", nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("quantity >= 1", name=op.f("ck_sale_list_cards_quantity")),
        sa.ForeignKeyConstraint(
            ["catalog_id"],
            ["cards.card_catalog.id"],
            name=op.f("fk_sale_list_cards_catalog_id_card_catalog"),
        ),
        sa.ForeignKeyConstraint(
            ["sale_list_id"],
            ["cards.sale_lists.id"],
            name=op.f("fk_sale_list_cards_sale_list_id_sale_lists"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sale_list_cards")),
        sa.UniqueConstraint(
            "sale_list_id",
            "catalog_id",
            "variant_type",
            name=op.f("uq_sale_list_cards_sale_list_id"),
        ),
        schema="cards",
    )
    op.create_index(
        op.f("ix_cards_sale_list_cards_sale_list_id"),
        "sale_list_cards",
        ["sale_list_id"],
        unique=False,
        schema="cards",
    )
    _history_sources("'manual', 'import', 'purchase', 'sale'")


def downgrade() -> None:
    op.execute(
        "UPDATE cards.collection_history SET source = 'manual' WHERE source = 'sale'"
    )
    _history_sources("'manual', 'import', 'purchase'")
    op.drop_index(
        op.f("ix_cards_sale_list_cards_sale_list_id"),
        table_name="sale_list_cards",
        schema="cards",
    )
    op.drop_table("sale_list_cards", schema="cards")
    op.drop_index(
        op.f("ix_cards_sale_lists_user_id"), table_name="sale_lists", schema="cards"
    )
    op.drop_table("sale_lists", schema="cards")


def _history_sources(sources: str) -> None:
    """collection_history.source also takes `sale` (a sold list)."""
    name = op.f("ck_collection_history_source")
    op.drop_constraint(name, "collection_history", schema="cards", type_="check")
    op.create_check_constraint(
        name, "collection_history", f"source IN ({sources})", schema="cards"
    )
