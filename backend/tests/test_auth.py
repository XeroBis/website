from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from core.models import RevokedToken, User
from core.security import CSRF_COOKIE, REFRESH_COOKIE, SESSION_COOKIE
from tests.conftest import PASSWORD, REGISTER_SECRET, csrf, login, make_user


def register(client, secret=REGISTER_SECRET, **overrides):
    body = {"email": "new@example.com", "password": PASSWORD, "pseudo": "Newbie"}
    return client.post(
        "/api/auth/register",
        json=body | overrides,
        headers={"X-Register-Secret": secret},
    )


def set_cookies(response) -> dict[str, str]:
    """Set-Cookie headers by cookie name."""
    return {
        h.split("=", 1)[0]: h.lower() for h in response.headers.get_list("set-cookie")
    }


# ── register ─────────────────────────────────────────────────────────────────


def test_register_creates_user_and_logs_in(client):
    r = register(client, email="New@Example.COM")
    assert r.status_code == 201
    assert r.json() == {
        "id": r.json()["id"],
        "email": "new@example.com",
        "pseudo": "Newbie",
        "language": "fr",
        "theme": "system",
        "is_admin": False,
        "apps": [],
    }
    assert client.get("/api/auth/me").json()["email"] == "new@example.com"


def test_register_needs_the_secret(client):
    assert register(client, secret="wrong").status_code == 403
    r = client.post(
        "/api/auth/register",
        json={"email": "new@example.com", "password": PASSWORD, "pseudo": "N"},
    )
    assert r.status_code == 403


def test_register_rejects_taken_email_case_insensitively(client, user):
    assert register(client, email="USER@example.com").status_code == 409


def test_register_validates_fields(client):
    assert register(client, password="short-11chr").status_code == 422
    assert register(client, email="not-an-email").status_code == 422
    assert register(client, pseudo="   ").status_code == 422
    assert register(client, pseudo="x" * 51).status_code == 422
    r = client.post(
        "/api/auth/register",
        json={"email": "new@example.com", "password": PASSWORD},
        headers={"X-Register-Secret": REGISTER_SECRET},
    )
    assert r.status_code == 422


def test_register_strips_pseudo(client):
    assert register(client, pseudo="  Spaced  ").json()["pseudo"] == "Spaced"


def test_register_is_rate_limited(client):
    codes = [register(client, secret="wrong").status_code for _ in range(21)]
    assert codes[:20] == [403] * 20
    assert codes[20] == 429


# ── login ────────────────────────────────────────────────────────────────────


def test_login_sets_session_cookies(client, user):
    r = login(client)
    assert r.status_code == 200
    assert r.json()["email"] == "user@example.com"
    cookies = set_cookies(r)
    assert set(cookies) == {SESSION_COOKIE, REFRESH_COOKIE, CSRF_COOKIE}
    for name in cookies:
        assert "samesite=lax" in cookies[name]
        assert "secure" not in cookies[name]  # COOKIE_SECURE=false in tests
        assert "domain=" not in cookies[name]  # no COOKIE_DOMAIN in tests
    assert "httponly" in cookies[SESSION_COOKIE]
    assert "httponly" in cookies[REFRESH_COOKIE]
    assert "httponly" not in cookies[CSRF_COOKIE]
    assert "path=/;" in cookies[SESSION_COOKIE]
    assert "path=/api/auth" in cookies[REFRESH_COOKIE]


def test_login_is_case_insensitive_on_email(client, user):
    assert login(client, email="User@Example.com").status_code == 200


def test_login_rejects_bad_credentials(client, user):
    assert login(client, password="wrong-password").status_code == 401
    assert login(client, email="nobody@example.com").status_code == 401
    assert client.cookies.get(SESSION_COOKIE) is None


def test_login_is_rate_limited(client, user):
    codes = [login(client, password="wrong").status_code for _ in range(11)]
    assert codes[:10] == [401] * 10
    assert codes[10] == 429
    assert login(client).status_code == 429  # even with the right password


# ── me ───────────────────────────────────────────────────────────────────────


def test_me_returns_current_user(client, user):
    login(client)
    assert client.get("/api/auth/me").json() == {
        "id": user.id,
        "email": "user@example.com",
        "pseudo": "Testy",
        "language": "fr",
        "theme": "system",
        "is_admin": False,
        "apps": [],
    }


def test_me_without_session_is_unauthorized(client):
    assert client.get("/api/auth/me").status_code == 401


def test_update_pseudo(client, user):
    login(client)
    r = client.patch("/api/auth/me", json={"pseudo": " Nick "}, headers=csrf(client))
    assert r.status_code == 200
    assert r.json()["pseudo"] == "Nick"
    assert client.get("/api/auth/me").json()["pseudo"] == "Nick"


def test_update_pseudo_validates(client, user):
    login(client)
    r = client.patch("/api/auth/me", json={"pseudo": ""}, headers=csrf(client))
    assert r.status_code == 422


def test_update_pseudo_needs_csrf(client, user):
    login(client)
    assert client.patch("/api/auth/me", json={"pseudo": "Nick"}).status_code == 403
    r = client.patch(
        "/api/auth/me", json={"pseudo": "Nick"}, headers={"x-csrf-token": "forged"}
    )
    assert r.status_code == 403


def test_update_pseudo_needs_session(client):
    assert client.patch("/api/auth/me", json={"pseudo": "Nick"}).status_code == 401


def test_update_language(client, user):
    login(client)
    r = client.patch(
        "/api/auth/me/language", json={"language": "en"}, headers=csrf(client)
    )
    assert r.status_code == 200
    assert r.json()["language"] == "en"
    assert client.get("/api/auth/me").json()["language"] == "en"


def test_update_language_only_accepts_en_fr(client, user):
    login(client)
    r = client.patch(
        "/api/auth/me/language", json={"language": "de"}, headers=csrf(client)
    )
    assert r.status_code == 422


def test_update_language_needs_csrf(client, user):
    login(client)
    r = client.patch("/api/auth/me/language", json={"language": "en"})
    assert r.status_code == 403


def test_update_theme(client, user):
    login(client)
    r = client.patch("/api/auth/me/theme", json={"theme": "dark"}, headers=csrf(client))
    assert r.status_code == 200
    assert r.json()["theme"] == "dark"
    assert client.get("/api/auth/me").json()["theme"] == "dark"


def test_update_theme_only_accepts_known_themes(client, user):
    login(client)
    r = client.patch(
        "/api/auth/me/theme", json={"theme": "sepia"}, headers=csrf(client)
    )
    assert r.status_code == 422


def test_update_theme_needs_csrf(client, user):
    login(client)
    r = client.patch("/api/auth/me/theme", json={"theme": "dark"})
    assert r.status_code == 403


# ── refresh ──────────────────────────────────────────────────────────────────


def test_refresh_rotates_tokens(client, user):
    login(client)
    old_session = client.cookies.get(SESSION_COOKIE)
    old_refresh = client.cookies.get(REFRESH_COOKIE)
    r = client.post("/api/auth/refresh", headers=csrf(client))
    assert r.status_code == 204
    assert client.cookies.get(SESSION_COOKIE) != old_session
    assert client.cookies.get(REFRESH_COOKIE) != old_refresh
    assert client.get("/api/auth/me").status_code == 200

    # The old refresh token is revoked: replaying it fails.
    client.cookies.set(REFRESH_COOKIE, old_refresh, path="/api/auth")
    assert client.post("/api/auth/refresh", headers=csrf(client)).status_code == 401


def test_refresh_needs_csrf(client, user):
    login(client)
    assert client.post("/api/auth/refresh").status_code == 403


def test_refresh_without_refresh_token_clears_cookies(client, user):
    login(client)
    client.cookies.delete(REFRESH_COOKIE)
    r = client.post("/api/auth/refresh", headers=csrf(client))
    assert r.status_code == 401
    assert set(set_cookies(r)) == {SESSION_COOKIE, REFRESH_COOKIE, CSRF_COOKIE}
    assert client.cookies.get(SESSION_COOKIE) is None


def test_refresh_rejects_access_token(client, user):
    login(client)
    client.cookies.set(
        REFRESH_COOKIE, client.cookies.get(SESSION_COOKIE), path="/api/auth"
    )
    assert client.post("/api/auth/refresh", headers=csrf(client)).status_code == 401


# ── logout ───────────────────────────────────────────────────────────────────


def test_logout_revokes_and_clears(client, user, db):
    login(client)
    session = client.cookies.get(SESSION_COOKIE)
    r = client.post("/api/auth/logout", headers=csrf(client))
    assert r.status_code == 204
    assert client.cookies.get(SESSION_COOKIE) is None
    assert db.scalar(select(func.count()).select_from(RevokedToken)) == 2

    # A copied session cookie can't be replayed after logout.
    client.cookies.set(SESSION_COOKIE, session)
    assert client.get("/api/auth/me").status_code == 401


def test_logout_needs_csrf(client, user):
    login(client)
    assert client.post("/api/auth/logout").status_code == 403
    assert client.get("/api/auth/me").status_code == 200


def test_logout_purges_expired_revocations(client, user, db):
    db.add(RevokedToken(jti="old", expires_at=datetime.now(UTC) - timedelta(days=1)))
    db.commit()
    login(client)
    client.post("/api/auth/logout", headers=csrf(client))
    jtis = db.scalars(select(RevokedToken.jti)).all()
    assert "old" not in jtis
    assert len(jtis) == 2


def test_other_users_are_unaffected_by_logout(client, user):
    make_user(email="other@example.com")
    login(client)
    client.post("/api/auth/logout", headers=csrf(client))
    assert login(client, email="other@example.com").status_code == 200
    assert client.get("/api/auth/me").json()["email"] == "other@example.com"


def test_user_row_defaults(db, user):
    row = db.get(User, user.id)
    assert row.language == "fr"
    assert row.is_admin is False
    assert row.created_at is not None
