"""create one schema per app

Revision ID: 0001
Revises:
Create Date: 2026-10-17

"""

from collections.abc import Sequence

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen copy of core.database.SCHEMAS at the time of this migration —
# migrations must not change meaning if that constant changes later.
SCHEMAS = ("core", "portfolio", "workout", "cards", "media")


def upgrade() -> None:
    for schema in SCHEMAS:
        op.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")


def downgrade() -> None:
    # `core` holds alembic_version itself, so it is left in place.
    for schema in reversed(SCHEMAS):
        if schema != "core":
            op.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
