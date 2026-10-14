# SPDX-License-Identifier: MIT
"""What an admin sees of the reports on presets and comments. Acting on one is the preset's `PATCH` (state unlisted) or the comment's `DELETE`."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin
from ..models import Report, User, now
from ..schemas import ReportOut

router = APIRouter(prefix="/api/admin/reports", tags=["admin"])


@router.get("", response_model=list[ReportOut])
def open_reports(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return db.scalars(select(Report).where(Report.resolved_at.is_(None)).order_by(Report.id)).all()


@router.post("/{report_id}/resolve", status_code=status.HTTP_204_NO_CONTENT)
def resolve(report_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    row = db.get(Report, report_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such report")
    row.resolved_at = now()
    db.commit()
