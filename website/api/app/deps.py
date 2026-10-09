# SPDX-License-Identifier: MIT
from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import ApiToken, User, UserSession, now
from .security import hash_token

COOKIE = "bleep_session"


def get_current_user(
    token: str | None = Cookie(default=None, alias=COOKIE), db: Session = Depends(get_db)
) -> User:
    if token:
        row = db.scalar(
            select(UserSession).where(UserSession.token_hash == hash_token(token), UserSession.expires_at > now())
        )
        if row and row.user.is_active:
            return row.user
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")


def require_role(*roles: str):
    """Dependency: the current user must have one of the roles. Admin-only: `Depends(require_role("admin"))`."""

    def check(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
        return user

    return check


require_admin = require_role("admin")


def require_release_token(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> ApiToken:
    """Dependency: `Authorization: Bearer <token>` with a release token an admin created."""
    scheme, _, value = (authorization or "").partition(" ")
    if scheme.lower() == "bearer" and value:
        row = db.scalar(select(ApiToken).where(ApiToken.token_hash == hash_token(value.strip())))
        if row and row.scope == "release" and (row.expires_at is None or row.expires_at > now()):
            row.last_used_at = now()
            db.commit()
            return row
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "A valid release token is required")
