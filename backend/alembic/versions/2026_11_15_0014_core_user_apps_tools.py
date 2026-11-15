"""core user_apps: allow the tools app

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-15 12:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD = "app IN ('portfolio', 'workout', 'cards', 'media')"
NEW = "app IN ('portfolio', 'workout', 'cards', 'media', 'tools')"


def upgrade() -> None:
    op.drop_constraint(
        op.f("ck_user_apps_app"), "user_apps", schema="core", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_user_apps_app"), "user_apps", NEW, schema="core"
    )


def downgrade() -> None:
    op.execute("DELETE FROM core.user_apps WHERE app = 'tools'")
    op.drop_constraint(
        op.f("ck_user_apps_app"), "user_apps", schema="core", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_user_apps_app"), "user_apps", OLD, schema="core"
    )
