# SPDX-License-Identifier: MIT
"""agent_usage: tokens used by the patch assistant per UTC day (the global daily budget)

Revision ID: 0011
Revises: 0010
"""
from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"


def upgrade() -> None:
    op.create_table(
        "agent_usage",
        sa.Column("day", sa.Date, primary_key=True),
        sa.Column("tokens", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("requests", sa.Integer, nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_table("agent_usage")
