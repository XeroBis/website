"""Create or update an account: `make seed-user` / `make seed-basic-user`.

Reads ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_PSEUDO. An existing account with
that email gets the password reset; its pseudo is kept. Without `--no-admin`
the account is made admin; with it, a new account is not admin and an
existing one keeps its `is_admin`.
"""

import sys

from pydantic import ValidationError
from pydantic_settings import BaseSettings
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.database import SessionLocal
from core.models import User
from core.security import hash_password
from domains.auth.schemas import RegisterIn


class AdminSettings(BaseSettings):
    model_config = {"env_prefix": "ADMIN_"}

    email: str
    password: str
    pseudo: str = "Admin"


def seed_admin(
    db: Session, email: str, password: str, pseudo: str, admin: bool = True
) -> User:
    # Same rules as sign-up (email format, password length, pseudo).
    valid = RegisterIn(email=email, password=password, pseudo=pseudo)
    user = db.scalar(select(User).where(User.email == valid.email))
    if user is None:
        user = User(email=valid.email, pseudo=valid.pseudo)
        db.add(user)
    user.hashed_password = hash_password(valid.password)
    if admin:
        user.is_admin = True
    db.commit()
    db.refresh(user)
    return user


def main() -> None:
    admin = "--no-admin" not in sys.argv[1:]
    try:
        settings = AdminSettings()
        with SessionLocal() as db:
            user = seed_admin(
                db, settings.email, settings.password, settings.pseudo, admin
            )
    except ValidationError as e:
        sys.exit(f"seed-user: {e}")
    role = "admin" if user.is_admin else "user"
    print(f"seed-user: {role} {user.email} (id {user.id}) ready")


if __name__ == "__main__":
    main()
