"""cards drop shopping lists

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-19 15:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("shopping_list_cards", schema="cards")
    op.drop_table("shopping_lists", schema="cards")


def downgrade() -> None:
    op.create_table(
        "shopping_lists",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
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
            name=op.f("fk_shopping_lists_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shopping_lists")),
        sa.UniqueConstraint("user_id", "name", name=op.f("uq_shopping_lists_user_id")),
        schema="cards",
    )
    op.create_table(
        "shopping_list_cards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("shopping_list_id", sa.Integer(), nullable=False),
        sa.Column("catalog_id", sa.Integer(), nullable=False),
        sa.Column("quantity_needed", sa.Integer(), nullable=False),
        sa.Column("quantity_owned", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "quantity_owned BETWEEN 0 AND quantity_needed",
            name=op.f("ck_shopping_list_cards_quantity_owned"),
        ),
        sa.ForeignKeyConstraint(
            ["catalog_id"],
            ["cards.card_catalog.id"],
            name=op.f("fk_shopping_list_cards_catalog_id_card_catalog"),
        ),
        sa.ForeignKeyConstraint(
            ["shopping_list_id"],
            ["cards.shopping_lists.id"],
            name=op.f("fk_shopping_list_cards_shopping_list_id_shopping_lists"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shopping_list_cards")),
        sa.UniqueConstraint(
            "shopping_list_id",
            "catalog_id",
            name=op.f("uq_shopping_list_cards_shopping_list_id"),
        ),
        schema="cards",
    )
