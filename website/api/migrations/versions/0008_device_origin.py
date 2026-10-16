# SPDX-License-Identifier: MIT
"""who started a device sign-in (shown to the user who approves it)

Revision ID: 0008
Revises: 0007
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"


def upgrade() -> None:
    op.add_column("device_codes", sa.Column("start_ip", sa.String(64), nullable=False, server_default=""))
    op.add_column("device_codes", sa.Column("start_agent", sa.String(200), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("device_codes", "start_agent")
    op.drop_column("device_codes", "start_ip")
