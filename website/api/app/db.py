# SPDX-License-Identifier: MIT
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import settings

if settings.database_url.startswith("sqlite"):  # tests: one shared in-memory database
    engine = create_engine(settings.database_url, connect_args={"check_same_thread": False}, poolclass=StaticPool)
else:
    engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db
