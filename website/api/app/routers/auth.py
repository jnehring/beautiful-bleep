# SPDX-License-Identifier: MIT
from datetime import timedelta, timezone
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import COOKIE, get_current_user
from .. import mail
from ..models import EmailToken, User, UserSession, now
from ..schemas import EmailTokenIn, ForgotPasswordIn, LoginIn, RegisterIn, ResetPasswordIn, UserOut
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


RESEND_AFTER = timedelta(seconds=60)  # the least time between two emails of one kind to one user (nobody can be mail-bombed through us)


def _aware(moment):
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _issue_token(db: Session, user: User, purpose: str, lifetime: timedelta) -> str | None:
    """A fresh single-use token (earlier unused ones of that kind stop working), or None if one was issued a moment ago."""
    last = db.scalar(select(EmailToken.created_at).where(EmailToken.user_id == user.id, EmailToken.purpose == purpose)
                     .order_by(EmailToken.created_at.desc()).limit(1))
    if last and now() - _aware(last) < RESEND_AFTER:
        return None
    db.execute(delete(EmailToken).where(EmailToken.user_id == user.id, EmailToken.purpose == purpose))
    token, token_hash = new_session_token()
    db.add(EmailToken(user_id=user.id, purpose=purpose, token_hash=token_hash, expires_at=now() + lifetime))
    db.commit()
    return token


def _queue_verification(db: Session, user: User, tasks: BackgroundTasks) -> None:
    if not settings.email_verification:
        return
    token = _issue_token(db, user, "verify", timedelta(hours=settings.verify_hours))
    if token:
        subject, text = mail.verification_message(user.display_name, f"{settings.public_url}/verify-email/?token={quote(token)}")
        tasks.add_task(mail.send, user.email, subject, text)


def _use_token(db: Session, token: str, purpose: str) -> User:
    row = db.scalar(select(EmailToken).where(EmailToken.token_hash == hash_token(token), EmailToken.purpose == purpose))
    if not row or row.used_at or _aware(row.expires_at) <= now():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This link is invalid or has expired")
    row.used_at = now()
    return db.get(User, row.user_id)


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, response: Response, tasks: BackgroundTasks, db: Session = Depends(get_db)):
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
    _queue_verification(db, user, tasks)
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


@router.post("/verify-email", response_model=UserOut)
def verify_email(body: EmailTokenIn, db: Session = Depends(get_db)):
    user = _use_token(db, body.token, "verify")
    if user.email_verified_at is None:
        user.email_verified_at = now()
    db.commit()
    return user


@router.post("/resend-verification", status_code=status.HTTP_202_ACCEPTED)
def resend_verification(tasks: BackgroundTasks, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not user.email_verified:
        _queue_verification(db, user, tasks)


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
def forgot_password(body: ForgotPasswordIn, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Always the same answer, so the form cannot be used to find out which emails are registered."""
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user and user.is_active:
        token = _issue_token(db, user, "reset", timedelta(minutes=settings.reset_minutes))
        if token:
            subject, text = mail.reset_message(user.display_name, f"{settings.public_url}/reset-password/?token={quote(token)}")
            tasks.add_task(mail.send, user.email, subject, text)


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(body: ResetPasswordIn, db: Session = Depends(get_db)):
    user = _use_token(db, body.token, "reset")
    if not user.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This link is invalid or has expired")
    user.password_hash = hash_password(body.new_password)
    if user.email_verified_at is None:  # the link reached their inbox
        user.email_verified_at = now()
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))  # whoever had the old password is out
    db.commit()
