"""The shared auth dependencies, exercised through a throwaway app."""

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from core import security
from core.database import SessionLocal
from core.deps import (
    get_current_user,
    get_optional_user,
    require_admin,
    require_app,
)
from core.models import User
from core.rate_limit import limiter
from core.security import SESSION_COOKIE, create_token
from domains.auth import router as auth
from tests.conftest import csrf, login, make_user

probe = FastAPI()
probe.state.limiter = limiter
probe.include_router(auth.router)


@probe.get("/optional")
def optional(user: User | None = Depends(get_optional_user)):
    return {"user": user.email if user else None}


@probe.post("/optional")
def optional_post(user: User | None = Depends(get_optional_user)):
    return {"user": user.email if user else None}


@probe.get("/current")
def current(user: User = Depends(get_current_user)):
    return {"user": user.email}


@probe.post("/current")
def current_post(user: User = Depends(get_current_user)):
    return {"user": user.email}


@probe.get("/admin")
def admin(user: User = Depends(require_admin)):
    return {"user": user.email}


@probe.get("/workout")
def workout(user: User = Depends(require_app("workout"))):
    return {"user": user.email}


@pytest.fixture
def client():
    with TestClient(probe) as c:
        yield c


def test_optional_user_is_none_when_anonymous(client):
    assert client.get("/optional").json() == {"user": None}
    assert client.post("/optional").json() == {"user": None}


def test_optional_user_with_session(client, user):
    login(client)
    assert client.get("/optional").json() == {"user": "user@example.com"}


def test_optional_user_with_invalid_session_is_401(client):
    # Not anonymous: the frontend should try a refresh.
    client.cookies.set(SESSION_COOKIE, "garbage")
    assert client.get("/optional").status_code == 401


def test_optional_user_unsafe_method_needs_csrf(client, user):
    login(client)
    assert client.post("/optional").status_code == 403
    assert client.post("/optional", headers=csrf(client)).status_code == 200


def test_current_user(client, user):
    assert client.get("/current").status_code == 401
    login(client)
    assert client.get("/current").json() == {"user": "user@example.com"}


def test_current_user_unsafe_method_needs_csrf(client, user):
    login(client)
    assert client.post("/current").status_code == 403
    assert client.post("/current", headers=csrf(client)).status_code == 200


def test_expired_session_is_401(client, user, monkeypatch):
    monkeypatch.setattr(security.auth_settings, "access_token_minutes", -1)
    client.cookies.set(SESSION_COOKIE, create_token(user.id, "access"))
    assert client.get("/current").status_code == 401


def test_refresh_token_is_not_a_session(client, user):
    client.cookies.set(SESSION_COOKIE, create_token(user.id, "refresh"))
    assert client.get("/current").status_code == 401


def test_token_signed_with_another_key_is_rejected(client, user, monkeypatch):
    monkeypatch.setattr(security.auth_settings, "secret_key", "x" * 32)
    forged = create_token(user.id, "access")
    monkeypatch.undo()
    client.cookies.set(SESSION_COOKIE, forged)
    assert client.get("/current").status_code == 401


def test_session_of_deleted_user_is_401(client, user):
    login(client)
    with SessionLocal() as db:
        db.delete(db.get(User, user.id))
        db.commit()
    assert client.get("/current").status_code == 401


def test_require_admin(client):
    make_user(email="admin@example.com", is_admin=True)
    make_user(email="user@example.com")
    assert client.get("/admin").status_code == 401
    login(client)
    assert client.get("/admin").status_code == 403
    login(client, email="admin@example.com")
    assert client.get("/admin").json() == {"user": "admin@example.com"}


def test_require_app(client):
    make_user(email="user@example.com")
    make_user(email="cards@example.com", apps=["cards"])
    make_user(email="workout@example.com", apps=["workout"])
    make_user(email="admin@example.com", is_admin=True)
    assert client.get("/workout").status_code == 401
    for email in ("user@example.com", "cards@example.com"):
        login(client, email=email)
        assert client.get("/workout").status_code == 403
    for email in ("workout@example.com", "admin@example.com"):
        login(client, email=email)
        assert client.get("/workout").json() == {"user": email}


def test_require_app_rejects_unknown_app():
    with pytest.raises(ValueError):
        require_app("auth")
