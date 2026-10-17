# SPDX-License-Identifier: MIT
"""agent_chat: one row per patch-assistant turn (user, time, tokens, cost) for the admin dashboard

Revision ID: 0012
Revises: 0011
"""
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"


def upgrade() -> None:
    op.create_table(
        "agent_chat",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("new_chat", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("input_tokens", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Float, nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_table("agent_chat")
