"""media: book series and undated reads

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-20 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "book_series",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["core.users.id"], name=op.f("fk_book_series_user_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_book_series")),
        schema="media",
    )
    op.create_index(
        "uq_book_series_user_id_name",
        "book_series",
        ["user_id", sa.text("lower(name)")],
        unique=True,
        schema="media",
    )

    op.add_column(
        "library_entries",
        sa.Column("series_id", sa.Integer(), nullable=True),
        schema="media",
    )
    op.add_column(
        "library_entries",
        sa.Column("series_volume", sa.SmallInteger(), nullable=True),
        schema="media",
    )
    op.create_index(
        op.f("ix_media_library_entries_series_id"),
        "library_entries",
        ["series_id"],
        schema="media",
    )
    op.create_foreign_key(
        op.f("fk_library_entries_series_id_book_series"),
        "library_entries",
        "book_series",
        ["series_id"],
        ["id"],
        source_schema="media",
        referent_schema="media",
        ondelete="SET NULL",
    )

    op.add_column(
        "reading_sessions",
        sa.Column("undated", sa.Boolean(), server_default=sa.false(), nullable=False),
        schema="media",
    )
    op.create_check_constraint(
        op.f("ck_reading_sessions_undated"),
        "reading_sessions",
        "NOT undated OR finished_on IS NULL",
        schema="media",
    )
    op.drop_index("uq_reading_sessions_one_open", "reading_sessions", schema="media")
    op.create_index(
        "uq_reading_sessions_one_open",
        "reading_sessions",
        ["library_entry_id"],
        unique=True,
        schema="media",
        postgresql_where=sa.text("finished_on IS NULL AND NOT undated"),
    )


def downgrade() -> None:
    op.drop_index("uq_reading_sessions_one_open", "reading_sessions", schema="media")
    # Undated reads become finish-only reads today (the closest dated form).
    op.execute(
        "UPDATE media.reading_sessions SET finished_on = GREATEST(CURRENT_DATE, "
        "COALESCE(started_on, CURRENT_DATE)) WHERE undated"
    )
    op.create_index(
        "uq_reading_sessions_one_open",
        "reading_sessions",
        ["library_entry_id"],
        unique=True,
        schema="media",
        postgresql_where=sa.text("finished_on IS NULL"),
    )
    op.drop_constraint(
        op.f("ck_reading_sessions_undated"),
        "reading_sessions",
        schema="media",
        type_="check",
    )
    op.drop_column("reading_sessions", "undated", schema="media")

    op.drop_constraint(
        op.f("fk_library_entries_series_id_book_series"),
        "library_entries",
        schema="media",
        type_="foreignkey",
    )
    op.drop_index(
        op.f("ix_media_library_entries_series_id"), "library_entries", schema="media"
    )
    op.drop_column("library_entries", "series_volume", schema="media")
    op.drop_column("library_entries", "series_id", schema="media")
    op.drop_index("uq_book_series_user_id_name", "book_series", schema="media")
    op.drop_table("book_series", schema="media")
