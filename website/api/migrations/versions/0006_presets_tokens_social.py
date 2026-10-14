# SPDX-License-Identifier: MIT
"""user tokens, device codes, presets, comments, ratings and reports

Revision ID: 0006
Revises: 0005
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"


def _now():
    return sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())


def upgrade() -> None:
    op.add_column("users", sa.Column("handle", sa.String(40)))
    op.create_index("ix_users_handle", "users", ["handle"], unique=True)
    op.create_table(
        "user_tokens",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("prefix", sa.String(12), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("scope", sa.String(16), nullable=False, server_default="store"),
        _now(),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "device_codes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("device_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("user_code", sa.String(9), nullable=False, unique=True),
        sa.Column("client_name", sa.String(80), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE")),
        _now(),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "presets",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("author_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("summary", sa.String(280), nullable=False, server_default=""),
        sa.Column("type", sa.String(8), nullable=False),
        sa.Column("tags", sa.JSON, nullable=False),
        sa.Column("license", sa.String(120), nullable=False, server_default="CC-BY-4.0"),
        sa.Column("state", sa.String(16), nullable=False, server_default="listed"),
        sa.Column("downloads", sa.Integer, nullable=False, server_default="0"),
        _now(),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("author_id", "slug", name="uq_presets_author_slug"),
    )
    op.create_table(
        "preset_versions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("preset_id", sa.Integer, sa.ForeignKey("presets.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("bytes", sa.Integer, nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("needs", sa.JSON, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), index=True),
        sa.UniqueConstraint("preset_id", "version", name="uq_preset_versions"),
    )
    op.create_table(
        "comments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("slug", sa.String(140), nullable=False),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("body", sa.Text, nullable=False),
        _now(),
    )
    op.create_index("ix_comments_entry", "comments", ["kind", "slug"])
    op.create_table(
        "ratings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False, index=True),
        sa.Column("slug", sa.String(140), nullable=False, index=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("stars", sa.Integer, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("kind", "slug", "user_id", name="uq_ratings_user_entry"),
        sa.CheckConstraint("stars BETWEEN 1 AND 5", name="ck_ratings_stars"),
    )
    op.create_table(
        "reports",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("target", sa.String(16), nullable=False),
        sa.Column("target_id", sa.Integer, nullable=False),
        sa.Column("reporter_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("reason", sa.String(500), nullable=False, server_default=""),
        _now(),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    for table in ("reports", "ratings", "comments", "preset_versions", "presets", "device_codes", "user_tokens"):
        op.drop_table(table)
    op.drop_index("ix_users_handle", table_name="users")
    op.drop_column("users", "handle")
