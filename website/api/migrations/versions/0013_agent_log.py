# SPDX-License-Identifier: MIT
"""agent_log: the patch assistant's rolling run log (model calls, tool calls, events)

Revision ID: 0013
Revises: 0012
"""
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"


def upgrade() -> None:
    op.create_table(
        "agent_log",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("run_id", sa.String(32), nullable=False, index=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("kind", sa.String(24), nullable=False, index=True),
        sa.Column("data", sa.JSON, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("agent_log")
