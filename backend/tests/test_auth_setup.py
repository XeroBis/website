"""Startup settings and the `make seed-user` script."""

import pytest
from pydantic import ValidationError

from core.models import User
from core.security import AuthSettings, verify_password
from domains.auth.seed import seed_admin
from tests.conftest import PASSWORD, make_user


def test_settings_require_secrets(monkeypatch):
    monkeypatch.delenv("SECRET_KEY")
    with pytest.raises(ValidationError):
        AuthSettings()


def test_settings_reject_short_secrets(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "too-short")
    with pytest.raises(ValidationError):
        AuthSettings()
    monkeypatch.setenv("SECRET_KEY", "x" * 32)
    monkeypatch.setenv("REGISTER_SECRET", "short")
    with pytest.raises(ValidationError):
        AuthSettings()


def test_settings_read_cookie_options(monkeypatch):
    monkeypatch.setenv("COOKIE_DOMAIN", ".alanbignon.com")
    monkeypatch.setenv("COOKIE_SECURE", "true")
    s = AuthSettings()
    assert (s.cookie_domain, s.cookie_secure) == (".alanbignon.com", True)


def test_seed_creates_admin(db):
    user = seed_admin(db, "Admin@Example.com", PASSWORD, "Boss")
    assert (user.email, user.pseudo, user.is_admin) == (
        "admin@example.com",
        "Boss",
        True,
    )
    assert verify_password(PASSWORD, user.hashed_password)


def test_seed_updates_existing_user(db):
    existing = make_user(email="admin@example.com", pseudo="Kept")
    user = seed_admin(db, "admin@example.com", "a-brand-new-password", "Ignored")
    assert user.id == existing.id
    assert (user.pseudo, user.is_admin) == ("Kept", True)
    assert verify_password("a-brand-new-password", user.hashed_password)
    assert db.query(User).count() == 1


def test_seed_applies_signup_rules(db):
    with pytest.raises(ValidationError):
        seed_admin(db, "admin@example.com", "short", "Boss")
