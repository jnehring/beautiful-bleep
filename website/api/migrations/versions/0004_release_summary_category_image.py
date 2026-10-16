# SPDX-License-Identifier: MIT
"""a release's summary, category and screenshot, shown on the library's tiles

Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"


def upgrade() -> None:
    op.add_column("releases", sa.Column("summary", sa.String(280), nullable=False, server_default=""))
    op.add_column("releases", sa.Column("category", sa.String(64), nullable=False, server_default=""))
    op.add_column("releases", sa.Column("image", sa.String(32), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("releases", "image")
    op.drop_column("releases", "category")
    op.drop_column("releases", "summary")
