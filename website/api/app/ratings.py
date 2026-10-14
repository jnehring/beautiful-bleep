# SPDX-License-Identifier: MIT
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Rating


def rating_summaries(db: Session, kind: str, slugs: list[str]) -> dict[str, tuple[float, int]]:
    """{slug: (average, count)} for the entries that have ratings."""
    if not slugs:
        return {}
    rows = db.execute(
        select(Rating.slug, func.avg(Rating.stars), func.count()).where(Rating.kind == kind, Rating.slug.in_(slugs)).group_by(Rating.slug)
    ).all()
    return {slug: (round(float(avg), 2), int(n)) for slug, avg, n in rows}
