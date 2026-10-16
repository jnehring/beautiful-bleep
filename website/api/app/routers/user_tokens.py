# SPDX-License-Identifier: MIT
"""Sign-in of the app (device flow, like `gh auth login`) and the user's personal access tokens."""
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .. import ratelimit
from ..db import get_db
from ..deps import get_current_user
from ..models import DeviceCode, User, UserToken, now
from ..schemas import (
    DeviceApproveIn, DeviceInfoOut, DevicePollIn, DevicePollOut, DeviceStartIn, DeviceStartOut, UserOut, UserTokenCreated,
    UserTokenIn, UserTokenOut,
)
from ..security import hash_token

router = APIRouter(tags=["tokens"])

DEVICE_MINUTES = 10
POLL_SECONDS = 5
_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789"  # no vowels (no words) and nothing that looks like another character


def _user_code() -> str:
    raw = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
    return raw[:4] + "-" + raw[4:]


def _normal(code: str) -> str:
    code = "".join(c for c in code.upper() if c.isalnum())
    return code[:4] + "-" + code[4:]


def _new_token(db: Session, user: User, name: str, expires_days: int | None = None) -> tuple[UserToken, str]:
    token = "blu_" + secrets.token_urlsafe(32)
    row = UserToken(user_id=user.id, name=name, prefix=token[:8], token_hash=hash_token(token), scope="store",
                    expires_at=now() + timedelta(days=expires_days) if expires_days else None)
    db.add(row)
    db.commit()
    return row, token


_device_start = ratelimit.limiter(10, 600)
_device_poll = ratelimit.limiter(120, 60)  # the app polls every POLL_SECONDS (5): 12 a minute per sign-in
_device_lookup = ratelimit.limiter(30, 60)  # guessing user codes
MAX_PENDING_CODES = 2000  # all addresses together: the table cannot be filled


# --- Device flow ---------------------------------------------------------------------------------------------------

@router.post("/api/auth/device", response_model=DeviceStartOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(ratelimit.by_ip(_device_start))])
def device_start(body: DeviceStartIn, db: Session = Depends(get_db)):
    """The app asks for a code. It shows `user_code`, opens `verification_url` and polls `/api/auth/device/token`."""
    db.execute(delete(DeviceCode).where(DeviceCode.expires_at < now() - timedelta(hours=1)))
    if (db.scalar(select(func.count()).select_from(DeviceCode).where(DeviceCode.status == "pending", DeviceCode.expires_at > now())) or 0) >= MAX_PENDING_CODES:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Too many sign-ins are waiting; try again in a few minutes")
    device_code = secrets.token_urlsafe(32)
    for _ in range(5):
        code = _user_code()
        if db.scalar(select(DeviceCode.id).where(DeviceCode.user_code == code)) is None:
            break
    db.add(DeviceCode(device_hash=hash_token(device_code), user_code=code, client_name=body.client_name,
                      expires_at=now() + timedelta(minutes=DEVICE_MINUTES)))
    db.commit()
    return DeviceStartOut(device_code=device_code, user_code=code, verification_url="/device/",
                          expires_in=DEVICE_MINUTES * 60, interval=POLL_SECONDS)


def _aware(moment):
    from datetime import timezone

    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


@router.post("/api/auth/device/token", response_model=DevicePollOut, dependencies=[Depends(ratelimit.by_ip(_device_poll))])
def device_poll(body: DevicePollIn, db: Session = Depends(get_db)):
    """The token comes once, to the first poll after the user approved; later polls find the code used up."""
    row = db.scalar(select(DeviceCode).where(DeviceCode.device_hash == hash_token(body.device_code)))
    if row is None or row.status == "used" or _aware(row.expires_at) < now():
        raise HTTPException(status.HTTP_410_GONE, "This sign-in has expired; start again")
    if row.status == "denied":
        db.delete(row)
        db.commit()
        return DevicePollOut(status="denied")
    if row.status != "approved":
        return DevicePollOut(status="pending")
    user = db.get(User, row.user_id)
    _, token = _new_token(db, user, f"{row.client_name or 'Bleep'} on {now():%Y-%m-%d}")
    row.status = "used"
    db.commit()
    return DevicePollOut(status="approved", token=token, user=UserOut.model_validate(user))


@router.get("/api/auth/device/{user_code}", response_model=DeviceInfoOut, dependencies=[Depends(ratelimit.by_ip(_device_lookup))])
def device_info(user_code: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """For the confirmation page: which app is asking."""
    row = db.scalar(select(DeviceCode).where(DeviceCode.user_code == _normal(user_code), DeviceCode.status == "pending"))
    if row is None or _aware(row.expires_at) < now():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown or expired code")
    return DeviceInfoOut(client_name=row.client_name)


@router.post("/api/auth/device/approve", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(ratelimit.by_ip(_device_lookup))])
def device_approve(body: DeviceApproveIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The logged-in user confirms (or refuses) the code an app shows."""
    row = db.scalar(select(DeviceCode).where(DeviceCode.user_code == _normal(body.user_code), DeviceCode.status == "pending"))
    if row is None or _aware(row.expires_at) < now():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown or expired code")
    row.status = "approved" if body.approve else "denied"
    row.user_id = user.id
    db.commit()


# --- Personal access tokens ----------------------------------------------------------------------------------------

@router.get("/api/tokens", response_model=list[UserTokenOut])
def list_tokens(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.scalars(select(UserToken).where(UserToken.user_id == user.id).order_by(UserToken.id)).all()


@router.post("/api/tokens", response_model=UserTokenCreated, status_code=status.HTTP_201_CREATED)
def create_token(body: UserTokenIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """A token for scripts. The token is in this response only."""
    row, token = _new_token(db, user, body.name, body.expires_in_days)
    return UserTokenCreated(**UserTokenOut.model_validate(row).model_dump(), token=token)


def _own_token(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> UserToken:
    """The personal token the request carries (`Authorization: Bearer blu_…`): the app asking about itself."""
    scheme, _, value = (authorization or "").partition(" ")
    row = db.scalar(select(UserToken).where(UserToken.token_hash == hash_token(value.strip()))) if scheme.lower() == "bearer" and value else None
    if row is None or not row.user.is_active or (row.expires_at is not None and _aware(row.expires_at) < now()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    return row


@router.get("/api/tokens/self", response_model=UserOut)
def whoami(row: UserToken = Depends(_own_token)):
    """Who the token belongs to; the app uses it to show the account and to find out that it was revoked."""
    return row.user


@router.delete("/api/tokens/self", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(row: UserToken = Depends(_own_token), db: Session = Depends(get_db)):
    """The app signs itself out: its token stops working."""
    db.delete(row)
    db.commit()


@router.delete("/api/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_token(token_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = db.get(UserToken, token_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such token")
    db.delete(row)
    db.commit()
