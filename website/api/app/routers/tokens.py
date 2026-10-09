# SPDX-License-Identifier: MIT
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin
from ..models import ApiToken, User, now
from ..schemas import TokenCreated, TokenIn, TokenOut
from ..security import hash_token

router = APIRouter(prefix="/api/admin/tokens", tags=["admin"])


@router.get("", response_model=list[TokenOut])
def list_tokens(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return db.scalars(select(ApiToken).order_by(ApiToken.id)).all()


@router.post("", response_model=TokenCreated, status_code=status.HTTP_201_CREATED)
def create_token(body: TokenIn, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """Creates a release token. The token itself is in this response only; the database keeps its hash."""
    token = "blp_" + secrets.token_urlsafe(32)
    row = ApiToken(
        name=body.name, prefix=token[:8], token_hash=hash_token(token), scope="release", created_by=admin.id,
        expires_at=now() + timedelta(days=body.expires_in_days) if body.expires_in_days else None,
    )
    db.add(row)
    db.commit()
    return TokenCreated(**TokenOut.model_validate(row).model_dump(), token=token)


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_token(token_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    row = db.get(ApiToken, token_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such token")
    db.delete(row)
    db.commit()
