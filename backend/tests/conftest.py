import os

# Must happen before `core.*`/`app` are imported anywhere: settings and the
# engine are built from the environment at import time.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://website:website@localhost:5440/website_test",
)

import psycopg  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from core import database  # noqa: E402


def _create_test_database() -> None:
    url = database.engine.url
    with psycopg.connect(
        dbname="postgres",
        user=url.username,
        password=url.password,
        host=url.host,
        port=url.port,
        autocommit=True,
    ) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (url.database,)
        ).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{url.database}"')


def _reset_schemas() -> None:
    with database.engine.begin() as conn:
        for schema in database.SCHEMAS:
            conn.exec_driver_sql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
            conn.exec_driver_sql(f"CREATE SCHEMA {schema}")
    database.Base.metadata.create_all(bind=database.engine)


_create_test_database()
_reset_schemas()

import app  # noqa: E402 -- safe to import now that the schema exists


@pytest.fixture(autouse=True)
def _clean_tables():
    yield
    with database.engine.begin() as conn:
        for table in reversed(database.Base.metadata.sorted_tables):
            conn.execute(table.delete())


@pytest.fixture
def client():
    with TestClient(app.app) as c:
        yield c
