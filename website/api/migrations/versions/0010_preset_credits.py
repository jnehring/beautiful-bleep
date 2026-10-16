# SPDX-License-Identifier: MIT
"""preset_credits: which shared presets a preset was made from (for "used in")

Revision ID: 0010
Revises: 0009
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"


def upgrade() -> None:
    op.create_table(
        "preset_credits",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("preset_id", sa.Integer, sa.ForeignKey("presets.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("source_address", sa.String(130), nullable=False, index=True),
        sa.Column("source_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("source_author", sa.String(80), nullable=False, server_default=""),
        sa.UniqueConstraint("preset_id", "source_address", name="uq_preset_credits"),
    )


def downgrade() -> None:
    op.drop_table("preset_credits")
