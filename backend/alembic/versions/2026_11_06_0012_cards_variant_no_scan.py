"""cards variant no_scan

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-06 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "card_catalog_variants",
        sa.Column("no_scan", sa.Boolean(), server_default="false", nullable=False),
        schema="cards",
    )


def downgrade() -> None:
    op.drop_column("card_catalog_variants", "no_scan", schema="cards")
