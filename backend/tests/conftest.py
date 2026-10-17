import os

# Must happen before `core.*`/`app` are imported anywhere: settings and the
# engine are built from the environment at import time.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://website:website@localhost:5440/website_test",
)
os.environ["SECRET_KEY"] = "test-secret-key-at-least-32-characters"
os.environ["REGISTER_SECRET"] = "test-register-secret"
os.environ["COOKIE_SECURE"] = "false"
os.environ.pop("COOKIE_DOMAIN", None)

import psycopg  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# Importing the models registers their tables on Base.metadata for
# create_all below.
from core import database, models  # noqa: E402, F401
from domains.media import models as media_models  # noqa: E402, F401
from domains.portfolio import models as portfolio_models  # noqa: E402, F401
from domains.workout import models as workout_models  # noqa: E402, F401


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
from core.models import User, UserApp  # noqa: E402
from core.rate_limit import limiter  # noqa: E402
from core.security import CSRF_COOKIE, hash_password  # noqa: E402

REGISTER_SECRET = os.environ["REGISTER_SECRET"]
PASSWORD = "correct-horse-battery"


@pytest.fixture(autouse=True)
def _clean_tables():
    limiter.reset()
    yield
    with database.engine.begin() as conn:
        for table in reversed(database.Base.metadata.sorted_tables):
            conn.execute(table.delete())


@pytest.fixture
def client():
    with TestClient(app.app) as c:
        yield c


@pytest.fixture
def db():
    with database.SessionLocal() as session:
        yield session


def make_user(
    email="user@example.com", pseudo="Testy", is_admin=False, apps=()
) -> User:
    with database.SessionLocal() as session:
        user = User(
            email=email,
            hashed_password=hash_password(PASSWORD),
            pseudo=pseudo,
            is_admin=is_admin,
            app_grants=[UserApp(app=app) for app in apps],
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return user


@pytest.fixture
def user() -> User:
    return make_user()


def login(client, email="user@example.com", password=PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def csrf(client) -> dict[str, str]:
    """The double-submit header for a client holding a session."""
    return {"x-csrf-token": client.cookies.get(CSRF_COOKIE)}
