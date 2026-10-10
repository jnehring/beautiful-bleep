# SPDX-License-Identifier: MIT
"""a release's licence and the code it is ported from, shown on the store's detail view

Revision ID: 0005
Revises: 0004
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"


def upgrade() -> None:
    op.add_column("releases", sa.Column("license", sa.String(120), nullable=False, server_default=""))
    op.add_column("releases", sa.Column("origin", sa.JSON(), nullable=False, server_default="{}"))


def downgrade() -> None:
    op.drop_column("releases", "origin")
    op.drop_column("releases", "license")
