# SPDX-License-Identifier: MIT
"""Module signing is gone: drop the developer keys and the signature fields of the stored releases

Revision ID: 0014
Revises: 0013
"""
from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"

DROPPED = ("contentDigest", "signature", "publication", "signer")


def upgrade() -> None:
    op.drop_table("developers")
    releases = sa.table("releases", sa.column("id", sa.Integer), sa.column("files", sa.JSON))
    bind = op.get_bind()
    for row in bind.execute(sa.select(releases.c.id, releases.c.files)).all():
        files = []
        for f in row.files or []:
            author = (f.get("signer") or {}).get("author")  # a community release keeps who published it
            f = {k: v for k, v in f.items() if k not in DROPPED}
            if author:
                f["author"] = author
            files.append(f)
        bind.execute(releases.update().where(releases.c.id == row.id).values(files=files))


def downgrade() -> None:
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
