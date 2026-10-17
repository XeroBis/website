from sqlalchemy import MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from core.config import settings

# One Postgres schema per app, plus `core` for what every app shares (users,
# sessions). Every model sets `__table_args__ = {"schema": "<one of these>"}`
# — see documentation/decisions.md "One database, one schema per app".
SCHEMAS = ("core", "portfolio", "workout", "cards", "media")

# Deterministic constraint names, so Alembic autogenerate produces stable
# migrations and constraints can be dropped by name later.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
