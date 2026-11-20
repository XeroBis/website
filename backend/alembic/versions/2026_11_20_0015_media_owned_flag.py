"""media library_entries: owned flag (books only) replaces owned_formats

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-20 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "library_entries",
        sa.Column("owned", sa.Boolean(), server_default=sa.false(), nullable=False),
        schema="media",
    )
    # A book with any format is owned; films' and series' formats are dropped.
    op.execute("""
        UPDATE media.library_entries e SET owned = true
        FROM media.media_items i
        WHERE i.id = e.media_item_id AND i.type = 'book'
          AND cardinality(e.owned_formats) > 0
        """)
    op.drop_column("library_entries", "owned_formats", schema="media")


def downgrade() -> None:
    op.add_column(
        "library_entries",
        sa.Column(
            "owned_formats",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        schema="media",
    )
    op.execute(
        "UPDATE media.library_entries SET owned_formats = '{paperback}' WHERE owned"
    )
    op.drop_column("library_entries", "owned", schema="media")
