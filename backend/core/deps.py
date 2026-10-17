"""Auth dependencies every domain uses on its routes.

- `get_current_user`: logged-in user, else 401.
- `get_optional_user`: logged-in user or None, for public routes.
- `require_admin`: logged-in admin, else 401/403.

On unsafe methods (anything but GET/HEAD/OPTIONS) a session also needs the
double-submit CSRF header (`x-csrf-token` == `csrf` cookie), else 403.
"""

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from core.database import get_db
from core.models import User
from core.security import (
    CSRF_COOKIE,
    CSRF_HEADER,
    SESSION_COOKIE,
    csrf_matches,
    decode_token,
)

SAFE_METHODS = ("GET", "HEAD", "OPTIONS")


def _unauthorized() -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")


def require_csrf(request: Request) -> None:
    if request.method in SAFE_METHODS:
        return
    if not csrf_matches(
        request.cookies.get(CSRF_COOKIE), request.headers.get(CSRF_HEADER)
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF token missing or invalid")


def _user_from_session(request: Request, db: Session) -> User | None:
    """None without a session cookie; 401 if there is one but it's invalid."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    user_id = decode_token(db, token, "access")
    user = db.get(User, user_id) if user_id is not None else None
    if user is None:
        # Expired, revoked or forged: 401 (not anonymous) so the frontend
        # tries a refresh, even on a public route.
        raise _unauthorized()
    require_csrf(request)
    return user


def get_optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    return _user_from_session(request, db)


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = _user_from_session(request, db)
    if user is None:
        raise _unauthorized()
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    return user
