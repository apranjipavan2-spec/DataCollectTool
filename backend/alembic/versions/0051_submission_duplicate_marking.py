"""Add submissions.is_duplicate + duplicate_of for confirmed duplicate marking.

Distinct from the existing data_json["_duplicate_suspect"] auto-heuristic set
at sync time: is_duplicate is the authoritative flag set by a supervisor via
the compare-and-resolve UI, excluded from KPI tiles and every Cleaner/Analyzer
data pull. duplicate_of records which submission it was merged into (doubles
as the "Restore" target). duplicate_dismissed_at marks submissions a
supervisor reviewed and confirmed are NOT duplicates (a coincidental
same-day/enumerator or identifier-field match) — permanently excluded from
future duplicate grouping so a dismissed false positive doesn't resurface.

Idempotent — a no-op where the columns/index already exist.
"""
import sqlalchemy as sa
from alembic import op

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text(
        "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN NOT NULL DEFAULT FALSE"
    ))
    conn.execute(sa.text(
        "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS duplicate_of UUID REFERENCES submissions(id) ON DELETE SET NULL"
    ))
    conn.execute(sa.text(
        "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS duplicate_dismissed_at TIMESTAMPTZ"
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_submissions_is_duplicate ON submissions (is_duplicate)"
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_submissions_duplicate_of ON submissions (duplicate_of)"
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_submissions_duplicate_dismissed_at ON submissions (duplicate_dismissed_at)"
    ))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("DROP INDEX IF EXISTS ix_submissions_duplicate_dismissed_at"))
    conn.execute(sa.text("DROP INDEX IF EXISTS ix_submissions_duplicate_of"))
    conn.execute(sa.text("DROP INDEX IF EXISTS ix_submissions_is_duplicate"))
    conn.execute(sa.text("ALTER TABLE submissions DROP COLUMN IF EXISTS duplicate_dismissed_at"))
    conn.execute(sa.text("ALTER TABLE submissions DROP COLUMN IF EXISTS duplicate_of"))
    conn.execute(sa.text("ALTER TABLE submissions DROP COLUMN IF EXISTS is_duplicate"))
