# SPDX-License-Identifier: MIT
"""presets: the cell categories a patch is in, and what it can be loaded as (instrument, effect)

Revision ID: 0017
Revises: 0016
"""
from alembic import op
import sqlalchemy as sa

revision = "0017"
down_revision = "0016"


def upgrade() -> None:
    op.add_column("presets", sa.Column("categories", sa.JSON, nullable=False, server_default="[]"))
    op.add_column("presets", sa.Column("roles", sa.JSON, nullable=False, server_default="[]"))


def downgrade() -> None:
    with op.batch_alter_table("presets") as batch:
        batch.drop_column("roles")
        batch.drop_column("categories")
