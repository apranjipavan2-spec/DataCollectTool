"""Extend the 360-day soft-delete bin to submissions, drafts, and push subs.

These three tables were still hard-deleted. Add a nullable `deleted_at` so
they follow the same soft-delete/restore/bin lifecycle as everything else.
Idempotent — a no-op where the columns already exist.
"""
import sqlalchemy as sa
from alembic import op

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None

_TABLES = [
    "submissions",
    "submission_drafts",
    "push_subscriptions",
]


def upgrade():
    conn = op.get_bind()
    for t in _TABLES:
        conn.execute(sa.text(
            f"ALTER TABLE {t} ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"
        ))
        conn.execute(sa.text(
            f"CREATE INDEX IF NOT EXISTS ix_{t}_deleted_at ON {t} (deleted_at)"
        ))


def downgrade():
    conn = op.get_bind()
    for t in _TABLES:
        conn.execute(sa.text(f"DROP INDEX IF EXISTS ix_{t}_deleted_at"))
        conn.execute(sa.text(f"ALTER TABLE {t} DROP COLUMN IF EXISTS deleted_at"))
