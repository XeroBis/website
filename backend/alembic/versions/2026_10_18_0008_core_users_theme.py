"""core users theme

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-18 15:15:51.067077

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("theme", sa.Text(), server_default="system", nullable=False),
        schema="core",
    )
    op.create_check_constraint(
        op.f("ck_users_theme"),
        "users",
        "theme IN ('system', 'light', 'dark')",
        schema="core",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_users_theme"), "users", schema="core", type_="check")
    op.drop_column("users", "theme", schema="core")
