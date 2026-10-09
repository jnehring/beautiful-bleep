# SPDX-License-Identifier: MIT
from alembic import context

from app import models  # noqa: F401  (registers the tables)
from app.db import Base, engine

def run() -> None:
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()

run()
