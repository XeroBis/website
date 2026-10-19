"""cards purchase list price

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-19 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "purchase_lists",
        sa.Column("price", sa.Numeric(precision=10, scale=2), nullable=True),
        schema="cards",
    )
    # Lists keep the total of the What I Paid entry they were created with;
    # the entries themselves stay.
    op.execute(
        "UPDATE cards.purchase_lists AS pl SET price = p.price "
        "FROM cards.purchases AS p WHERE p.id = pl.purchase_id"
    )
    op.drop_column("purchase_lists", "purchase_id", schema="cards")


def downgrade() -> None:
    op.add_column(
        "purchase_lists",
        sa.Column("purchase_id", sa.Integer(), nullable=True),
        schema="cards",
    )
    op.create_foreign_key(
        None,
        "purchase_lists",
        "purchases",
        ["purchase_id"],
        ["id"],
        source_schema="cards",
        referent_schema="cards",
        ondelete="SET NULL",
    )
    op.drop_column("purchase_lists", "price", schema="cards")
