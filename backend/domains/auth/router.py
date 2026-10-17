import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.database import get_db
from core.deps import get_current_user, require_admin, require_csrf
from core.models import APPS, User, UserApp
from core.rate_limit import limiter
from core.security import (
    REFRESH_COOKIE,
    SESSION_COOKIE,
    auth_settings,
    clear_session_cookies,
    decode_token,
    hash_password,
    purge_expired_revocations,
    revoke_token,
    set_session_cookies,
    verify_password,
)
from domains.auth.schemas import (
    AdminUserOut,
    AppsUpdate,
    LanguageUpdate,
    LoginIn,
    PseudoUpdate,
    RegisterIn,
    UserOut,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Hash compared against when the email is unknown, so a failed login takes
# the same time whether or not the account exists.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


@router.post("/register", response_model=UserOut, status_code=201)
@limiter.limit("20/hour")
def register(
    request: Request,
    payload: RegisterIn,
    response: Response,
    db: Session = Depends(get_db),
    x_register_secret: str = Header(default=""),
):
    """Invite-only: needs the X-Register-Secret header. Logs the user in."""
    if not secrets.compare_digest(x_register_secret, auth_settings.register_secret):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid sign-up code")
    if db.scalar(select(User.id).where(User.email == payload.email)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        pseudo=payload.pseudo,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    set_session_cookies(response, user.id)
    return user


@router.post("/login", response_model=UserOut)
@limiter.limit("10/minute")
def login(
    request: Request,
    payload: LoginIn,
    response: Response,
    db: Session = Depends(get_db),
):
    user = db.scalar(select(User).where(User.email == payload.email))
    if not verify_password(
        payload.password, user.hashed_password if user else _DUMMY_HASH
    ):
        user = None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    set_session_cookies(response, user.id)
    return user


@router.post("/refresh", status_code=204, dependencies=[Depends(require_csrf)])
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    """New session + refresh pair; the old refresh token is revoked (rotation)."""
    token = request.cookies.get(REFRESH_COOKIE)
    user_id = decode_token(db, token, "refresh") if token else None
    if user_id is None or db.get(User, user_id) is None:
        # Clear the dead cookies so the next request is plainly anonymous
        # instead of another 401 → refresh round-trip.
        failed = JSONResponse({"detail": "Not authenticated"}, status_code=401)
        clear_session_cookies(failed)
        return failed
    revoke_token(db, token)
    purge_expired_revocations(db)
    set_session_cookies(response, user_id)
    return None


@router.post("/logout", status_code=204, dependencies=[Depends(require_csrf)])
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    for name in (SESSION_COOKIE, REFRESH_COOKIE):
        if token := request.cookies.get(name):
            revoke_token(db, token)
    purge_expired_revocations(db)
    clear_session_cookies(response)
    return None


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserOut)
def update_pseudo(
    payload: PseudoUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user.pseudo = payload.pseudo
    db.commit()
    return user


@router.patch("/me/language", response_model=UserOut)
def update_language(
    payload: LanguageUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user.language = payload.language
    db.commit()
    return user


# ── admin: app access ────────────────────────────────────────────────────────


@router.get(
    "/users",
    response_model=list[AdminUserOut],
    dependencies=[Depends(require_admin)],
)
def list_users(db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.created_at, User.id)).all()


@router.put(
    "/users/{user_id}/apps",
    response_model=AdminUserOut,
    dependencies=[Depends(require_admin)],
)
def set_user_apps(user_id: int, payload: AppsUpdate, db: Session = Depends(get_db)):
    """Full replace of the user's grants (no effect on an admin's access)."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    wanted = set(payload.apps)
    granted = {grant.app for grant in user.app_grants}
    user.app_grants = [grant for grant in user.app_grants if grant.app in wanted] + [
        UserApp(app=app) for app in APPS if app in wanted - granted
    ]
    db.commit()
    db.refresh(user)
    return user
