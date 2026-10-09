# SPDX-License-Identifier: MIT
"""api tokens and releases

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"


def upgrade() -> None:
    op.create_table(
        "api_tokens",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("prefix", sa.String(12), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("scope", sa.String(16), nullable=False, server_default="release"),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "releases",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("major", sa.Integer, nullable=False),
        sa.Column("minor", sa.Integer, nullable=False),
        sa.Column("patch", sa.Integer, nullable=False),
        sa.Column("channel", sa.String(16), nullable=False, server_default="stable"),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("title", sa.String(120), nullable=False, server_default=""),
        sa.Column("notes", sa.Text, nullable=False, server_default=""),
        sa.Column("requires", sa.JSON, nullable=False),
        sa.Column("files", sa.JSON, nullable=False),
        sa.Column("created_by_token", sa.Integer, sa.ForeignKey("api_tokens.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("kind", "slug", "version", name="uq_releases_version"),
    )


def downgrade() -> None:
    op.drop_table("releases")
    op.drop_table("api_tokens")
