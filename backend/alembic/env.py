from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# Import every module defining models here so they register on Base.metadata
# and autogenerate sees them.
from core import models as core_models  # noqa: F401, E402
from core.config import settings
from core.database import SCHEMAS, Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata


def include_name(name, type_, parent_names):
    # Only look at our own schemas, so autogenerate never proposes dropping
    # anything else living in the database (e.g. `public`).
    if type_ == "schema":
        return name in SCHEMAS
    return True


def _configure(**kwargs) -> None:
    context.configure(
        target_metadata=target_metadata,
        include_schemas=True,
        include_name=include_name,
        # The single alembic_version table lives in `core`, next to the
        # tables every app shares.
        version_table_schema="core",
        compare_type=True,
        **kwargs,
    )


def run_migrations_offline() -> None:
    _configure(
        url=config.get_main_option("sqlalchemy.url"),
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        # version_table_schema="core" needs the schema to exist before
        # Alembic creates its alembic_version table, i.e. before the first
        # migration (which creates the other schemas) runs.
        connection.exec_driver_sql("CREATE SCHEMA IF NOT EXISTS core")
        connection.commit()
        _configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
