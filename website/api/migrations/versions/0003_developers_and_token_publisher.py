# SPDX-License-Identifier: MIT
"""developer keys, and the publisher of a release token

Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"


def upgrade() -> None:
    op.add_column("api_tokens", sa.Column("publisher", sa.String(40)))
    op.create_table(
        "developers",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("publisher", sa.String(40), nullable=False, index=True),
        sa.Column("key_id", sa.String(32), nullable=False, unique=True),
        sa.Column("scopes", sa.JSON, nullable=False),
        sa.Column("first_party", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("not_after", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("developers")
    op.drop_column("api_tokens", "publisher")
