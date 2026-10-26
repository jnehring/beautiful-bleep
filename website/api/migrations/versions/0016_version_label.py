# SPDX-License-Identifier: MIT
"""preset_versions: the author's version number ("1.0"), shown in links and pages

Revision ID: 0016
Revises: 0015
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"


def upgrade() -> None:
    op.add_column("preset_versions", sa.Column("label", sa.String(16), nullable=False, server_default=""))
    op.execute("UPDATE preset_versions SET label = CAST(version AS VARCHAR) || '.0'")


def downgrade() -> None:
    with op.batch_alter_table("preset_versions") as batch:
        batch.drop_column("label")
