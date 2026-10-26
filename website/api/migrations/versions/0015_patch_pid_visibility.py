# SPDX-License-Identifier: MIT
"""presets: public ID and visibility (private | public); state is moderation only (listed | removed)

Revision ID: 0015
Revises: 0014
"""
import secrets

from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"

ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def upgrade() -> None:
    op.add_column("presets", sa.Column("pid", sa.String(10)))
    op.add_column("presets", sa.Column("visibility", sa.String(8), nullable=False, server_default="private"))
    conn = op.get_bind()
    used: set[str] = set()
    for (row_id,) in conn.execute(sa.text("SELECT id FROM presets")).fetchall():
        pid = "".join(secrets.choice(ALPHABET) for _ in range(10))
        while pid in used:
            pid = "".join(secrets.choice(ALPHABET) for _ in range(10))
        used.add(pid)
        conn.execute(sa.text("UPDATE presets SET pid = :pid WHERE id = :id"), {"pid": pid, "id": row_id})
    # What was shared stays public. What was hidden (by its author or an admin) becomes removed: only an admin could list it again.
    conn.execute(sa.text("UPDATE presets SET visibility = 'public' WHERE state = 'listed'"))
    conn.execute(sa.text("UPDATE presets SET state = 'removed' WHERE state = 'unlisted'"))
    with op.batch_alter_table("presets") as batch:
        batch.alter_column("pid", existing_type=sa.String(10), nullable=False)
        batch.create_index("ix_presets_pid", ["pid"], unique=True)


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("UPDATE presets SET state = 'unlisted' WHERE state = 'removed' OR visibility = 'private'"))
    with op.batch_alter_table("presets") as batch:
        batch.drop_index("ix_presets_pid")
        batch.drop_column("visibility")
        batch.drop_column("pid")
