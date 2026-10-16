# SPDX-License-Identifier: MIT
from datetime import timezone

from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import ApiToken, User, UserSession, UserToken, now
from .security import hash_token

COOKIE = "bleep_session"


def get_current_user(
    token: str | None = Cookie(default=None, alias=COOKIE), db: Session = Depends(get_db)
) -> User:
    if token:
        row = db.scalar(
            select(UserSession).where(UserSession.token_hash == hash_token(token), UserSession.expires_at > now())
        )
        if row and row.user.is_active and row.user.email_verified:
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
        if row and row.scope == "release" and (row.expires_at is None or (row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)) > now()):
            row.last_used_at = now()
            db.commit()
            return row
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "A valid release token is required")


def _aware(moment):
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _session_user(token: str | None, db: Session) -> User | None:
    if not token:
        return None
    row = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token), UserSession.expires_at > now()))
    return row.user if row and row.user.is_active and row.user.email_verified else None


def _bearer_user(authorization: str | None, db: Session) -> User | None:
    scheme, _, value = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not value:
        return None
    row = db.scalar(select(UserToken).where(UserToken.token_hash == hash_token(value.strip())))
    if row and row.scope == "library" and row.user.is_active and row.user.email_verified and (row.expires_at is None or _aware(row.expires_at) > now()):
        row.last_used_at = now()
        db.commit()
        return row.user
    return None


def get_optional_library_user(
    cookie: str | None = Cookie(default=None, alias=COOKIE), authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User | None:
    """Who is acting in the library: the website's session cookie, or a personal access token of the app (`Authorization: Bearer blu_…`)."""
    return _bearer_user(authorization, db) or _session_user(cookie, db)


def get_library_user(user: User | None = Depends(get_optional_library_user)) -> User:
    """Publishing, commenting and rating: a login by cookie or by personal token. Other endpoints (profile, admin) take the cookie only."""
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    return user


def same_origin(request: Request) -> bool:
    """A cookie-authenticated write must come from this site. Browsers send `Origin` on cross-site writes, so a different one is refused;
    requests without it (the app, scripts, tests) cannot be forged by a web page. `BLEEP_ALLOWED_ORIGINS` adds hosts (a dev server)."""
    from urllib.parse import urlsplit

    from .config import settings

    origin = request.headers.get("origin")
    if not origin:
        return True
    host = urlsplit(origin).netloc
    allowed = {request.headers.get("host"), request.headers.get("x-forwarded-host"), *settings.allowed_origin_hosts}
    return host in allowed
