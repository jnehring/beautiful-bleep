# SPDX-License-Identifier: MIT
"""The dev channel: development builds with a build time in the version, tokens that name their channels, users with dev access

Revision ID: 0018
Revises: 0017
"""
from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"


def upgrade() -> None:
    op.add_column("users", sa.Column("dev_access", sa.Boolean, nullable=False, server_default=sa.false()))
    op.add_column("api_tokens", sa.Column("channels", sa.JSON, nullable=False, server_default='["stable", "beta"]'))
    op.add_column("releases", sa.Column("build", sa.Integer, nullable=False, server_default="0"))
    with op.batch_alter_table("releases") as batch:
        batch.alter_column("version", existing_type=sa.String(32), type_=sa.String(48), existing_nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("releases") as batch:
        batch.drop_column("build")
    with op.batch_alter_table("api_tokens") as batch:
        batch.drop_column("channels")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("dev_access")
