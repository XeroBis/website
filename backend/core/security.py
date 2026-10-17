"""Session primitives: auth settings, password hashing, JWTs and cookies.

Kept apart from `core.config` so that Alembic (which only needs the database
URL) runs without the auth secrets, while the app itself refuses to start
without them.
"""

import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

import jwt
from fastapi import Response
from pwdlib import PasswordHash
from pydantic import Field
from pydantic_settings import BaseSettings
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.models import RevokedToken


class AuthSettings(BaseSettings):
    # No defaults: a missing or short secret fails at import, i.e. at startup.
    secret_key: str = Field(min_length=32)
    register_secret: str = Field(min_length=16)
    # Dev: no Domain (host-only on `localhost`, shared by every port), not
    # Secure (plain http). Prod: `.alanbignon.com`, Secure.
    cookie_domain: str | None = None
    cookie_secure: bool = False
    access_token_minutes: int = 15
    refresh_token_days: int = 30


auth_settings = AuthSettings()

ALGORITHM = "HS256"
TOKEN_ISSUER = "alanbignon.com"
TOKEN_AUDIENCE = "alanbignon.com"

SESSION_COOKIE = "session"
REFRESH_COOKIE = "refresh"
CSRF_COOKIE = "csrf"
CSRF_HEADER = "x-csrf-token"
# The refresh token is only ever needed by /api/auth/refresh and /logout.
REFRESH_COOKIE_PATH = "/api/auth"

TokenType = Literal["access", "refresh"]

_password_hash = PasswordHash.recommended()  # argon2id


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return _password_hash.verify(password, hashed)


def create_token(user_id: int, typ: TokenType) -> str:
    now = datetime.now(UTC)
    lifetime = (
        timedelta(minutes=auth_settings.access_token_minutes)
        if typ == "access"
        else timedelta(days=auth_settings.refresh_token_days)
    )
    payload = {
        "sub": str(user_id),
        "iat": now,
        "nbf": now,
        "exp": now + lifetime,
        "iss": TOKEN_ISSUER,
        "aud": TOKEN_AUDIENCE,
        "jti": str(uuid.uuid4()),
        "typ": typ,
    }
    return jwt.encode(payload, auth_settings.secret_key, algorithm=ALGORITHM)


def decode_token(db: Session, token: str, typ: TokenType) -> int | None:
    """User id of a valid, unrevoked token of type `typ`, else None."""
    try:
        payload = jwt.decode(
            token,
            auth_settings.secret_key,
            algorithms=[ALGORITHM],
            audience=TOKEN_AUDIENCE,
            issuer=TOKEN_ISSUER,
            options={"require": ["sub", "exp", "jti", "typ"]},
        )
    except jwt.InvalidTokenError:
        return None
    if payload["typ"] != typ or is_revoked(db, payload["jti"]):
        return None
    try:
        return int(payload["sub"])
    except ValueError:
        return None


def is_revoked(db: Session, jti: str) -> bool:
    return db.scalar(select(RevokedToken.id).where(RevokedToken.jti == jti)) is not None


def revoke_token(db: Session, token: str) -> None:
    """Add a token's `jti` to the denylist (idempotent; ignores garbage)."""
    try:
        payload = jwt.decode(
            token,
            auth_settings.secret_key,
            algorithms=[ALGORITHM],
            options={"verify_exp": False, "verify_aud": False, "verify_iss": False},
        )
        jti, exp = payload["jti"], payload["exp"]
    except jwt.InvalidTokenError, KeyError:
        return
    try:
        db.add(RevokedToken(jti=jti, expires_at=datetime.fromtimestamp(exp, tz=UTC)))
        db.commit()
    except IntegrityError:
        db.rollback()  # already revoked


def purge_expired_revocations(db: Session) -> None:
    """An expired token is rejected anyway, so its denylist row is useless."""
    db.execute(delete(RevokedToken).where(RevokedToken.expires_at < func.now()))
    db.commit()


def csrf_matches(cookie: str | None, header: str | None) -> bool:
    return bool(cookie and header and secrets.compare_digest(cookie, header))


def set_session_cookies(response: Response, user_id: int) -> None:
    refresh_max_age = auth_settings.refresh_token_days * 86400
    common = {
        "secure": auth_settings.cookie_secure,
        "samesite": "lax",
        "domain": auth_settings.cookie_domain,
    }
    # The session cookie outlives the access token inside it on purpose: an
    # expired token still reaches the backend, which answers 401, which makes
    # the frontend refresh. Were the cookie to vanish with the token, a
    # public page would silently treat the user as anonymous.
    response.set_cookie(
        SESSION_COOKIE,
        create_token(user_id, "access"),
        max_age=refresh_max_age,
        httponly=True,
        path="/",
        **common,
    )
    response.set_cookie(
        REFRESH_COOKIE,
        create_token(user_id, "refresh"),
        max_age=refresh_max_age,
        httponly=True,
        path=REFRESH_COOKIE_PATH,
        **common,
    )
    # Readable by JS on purpose: echoed back as the x-csrf-token header
    # (double-submit). Lives as long as the refresh token, so the frontend
    # can tell whether a refresh is worth trying.
    response.set_cookie(
        CSRF_COOKIE,
        secrets.token_urlsafe(32),
        max_age=refresh_max_age,
        httponly=False,
        path="/",
        **common,
    )


def clear_session_cookies(response: Response) -> None:
    for name, path in (
        (SESSION_COOKIE, "/"),
        (REFRESH_COOKIE, REFRESH_COOKIE_PATH),
        (CSRF_COOKIE, "/"),
    ):
        response.delete_cookie(
            name,
            path=path,
            domain=auth_settings.cookie_domain,
            secure=auth_settings.cookie_secure,
            samesite="lax",
        )
