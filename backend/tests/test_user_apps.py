"""App access: `core.user_apps` grants, managed by admins (`/api/auth/users`)."""

import pytest
from sqlalchemy import select

from core.database import SessionLocal
from core.models import User, UserApp
from tests.conftest import csrf, login, make_user

USERS = "/api/auth/users"


@pytest.fixture
def admin(client):
    make_user(email="admin@example.com", pseudo="Boss", is_admin=True)
    login(client, email="admin@example.com")
    return client


def set_apps(client, user_id, apps):
    return client.put(
        f"{USERS}/{user_id}/apps", json={"apps": apps}, headers=csrf(client)
    )


def test_new_users_have_no_app(client, user):
    login(client)
    assert client.get("/api/auth/me").json()["apps"] == []


def test_admins_have_every_app(admin):
    assert admin.get("/api/auth/me").json()["apps"] == [
        "portfolio",
        "workout",
        "cards",
        "media",
    ]


def test_list_users_oldest_first(admin, user):
    r = admin.get(USERS)
    assert r.status_code == 200
    users = r.json()
    assert [u["email"] for u in users] == ["admin@example.com", "user@example.com"]
    assert users[1] == {
        "id": user.id,
        "email": "user@example.com",
        "pseudo": "Testy",
        "language": "fr",
        "theme": "system",
        "is_admin": False,
        "apps": [],
        "created_at": users[1]["created_at"],
    }


def test_set_apps_replaces_grants_in_app_order(admin, user):
    r = set_apps(admin, user.id, ["media", "workout", "media"])
    assert r.status_code == 200
    assert r.json()["apps"] == ["workout", "media"]
    assert set_apps(admin, user.id, ["cards", "workout"]).json()["apps"] == [
        "workout",
        "cards",
    ]
    assert set_apps(admin, user.id, []).json()["apps"] == []


def test_granted_apps_show_on_me(admin, user, client):
    set_apps(admin, user.id, ["cards"])
    login(client)
    assert client.get("/api/auth/me").json()["apps"] == ["cards"]


def test_set_apps_rejects_unknown_app(admin, user):
    assert set_apps(admin, user.id, ["auth"]).status_code == 422


def test_set_apps_unknown_user_is_404(admin):
    assert set_apps(admin, 999999, ["cards"]).status_code == 404


def test_users_endpoints_are_admin_only(client, user):
    assert client.get(USERS).status_code == 401
    login(client)
    assert client.get(USERS).status_code == 403
    assert set_apps(client, user.id, ["cards"]).status_code == 403


def test_set_apps_needs_csrf(admin, user):
    r = admin.put(f"{USERS}/{user.id}/apps", json={"apps": ["cards"]})
    assert r.status_code == 403


def test_grants_are_deleted_with_the_user(admin, user):
    set_apps(admin, user.id, ["cards", "media"])
    with SessionLocal() as db:
        db.delete(db.get(User, user.id))
        db.commit()
        assert db.scalars(select(UserApp)).all() == []
