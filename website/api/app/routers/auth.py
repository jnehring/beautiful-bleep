# SPDX-License-Identifier: MIT
from datetime import timedelta

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import COOKIE, get_current_user
from ..models import User, UserSession, now
from ..schemas import LoginIn, RegisterIn, UserOut
from ..security import hash_password, hash_token, new_session_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _start_session(db: Session, user: User, response: Response) -> None:
    token, token_hash = new_session_token()
    expires = now() + timedelta(days=settings.session_days)
    db.add(UserSession(token_hash=token_hash, user_id=user.id, expires_at=expires))
    db.commit()
    response.set_cookie(
        COOKIE, token, max_age=settings.session_days * 86400, httponly=True,
        secure=settings.cookie_secure, samesite="lax", path="/",
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, response: Response, db: Session = Depends(get_db)):
    user = User(
        email=body.email.lower(), password_hash=hash_password(body.password),
        display_name=body.display_name, role="user",
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "That email is already registered")
    _start_session(db, user, response)
    return user


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    ok = verify_password(body.password, user.password_hash if user else None)
    if not (ok and user and user.is_active):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    _start_session(db, user, response)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, token: str | None = Cookie(default=None, alias=COOKIE), db: Session = Depends(get_db)):
    if token:
        row = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
        if row:
            db.delete(row)
            db.commit()
    response.delete_cookie(COOKIE, path="/")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
