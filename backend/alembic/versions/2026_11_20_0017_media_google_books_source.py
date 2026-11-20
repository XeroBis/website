"""media: Google Books replaces Open Library

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-20 18:00:00.000000

Open Library work ids have no Google Books equivalent: existing Open Library
books become manual items (title, creators, year, genres, synopsis, ISBN and
cover kept, never refreshed again), then the enum value is renamed.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE media.media_items SET source = 'manual', external_id = NULL "
        "WHERE source = 'openlibrary'"
    )
    op.execute(
        "ALTER TYPE media.media_source RENAME VALUE 'openlibrary' TO 'googlebooks'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE media.media_items SET source = 'manual', external_id = NULL "
        "WHERE source = 'googlebooks'"
    )
    op.execute(
        "ALTER TYPE media.media_source RENAME VALUE 'googlebooks' TO 'openlibrary'"
    )
