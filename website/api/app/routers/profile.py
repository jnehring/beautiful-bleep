# SPDX-License-Identifier: MIT
from fastapi import APIRouter, Cookie, Depends, HTTPException, status
from sqlalchemy import delete
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import COOKIE, get_current_user
from ..models import User, UserSession, UserToken
from ..schemas import PasswordIn, ProfileIn, UserOut
from ..security import hash_password, hash_token, verify_password

router = APIRouter(prefix="/api/me", tags=["profile"])


@router.patch("", response_model=UserOut)
def update_profile(body: ProfileIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    for field, value in body.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(user, field, value)
    db.add(user)
    db.commit()
    return user


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: PasswordIn,
    user: User = Depends(get_current_user),
    token: str | None = Cookie(default=None, alias=COOKIE),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is wrong")
    user.password_hash = hash_password(body.new_password)
    # Sign out every other device.
    db.execute(delete(UserSession).where(UserSession.user_id == user.id, UserSession.token_hash != hash_token(token or "")))
    db.execute(delete(UserToken).where(UserToken.user_id == user.id))  # personal access tokens stop working as well
    db.add(user)
    db.commit()
