# SPDX-License-Identifier: MIT
"""releases.build holds a build time YYYYMMDDHHMM (202610280507), which does not fit a 32-bit integer

Revision ID: 0019
Revises: 0018
"""
from alembic import op
import sqlalchemy as sa

revision = "0019"
down_revision = "0018"


def upgrade() -> None:
    with op.batch_alter_table("releases") as batch:
        batch.alter_column("build", existing_type=sa.Integer, type_=sa.BigInteger, existing_nullable=False, existing_server_default="0")


def downgrade() -> None:
    with op.batch_alter_table("releases") as batch:
        batch.alter_column("build", existing_type=sa.BigInteger, type_=sa.Integer, existing_nullable=False, existing_server_default="0")
