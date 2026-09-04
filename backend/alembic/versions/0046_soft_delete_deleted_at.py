"""Add deleted_at (360-day soft-delete bin) to every table that was hard-deleted.

Nothing is physically removed on delete anymore — rows get a `deleted_at`
timestamp and are hidden from normal queries, restorable from the Bin, and
purged only after 360 days. Idempotent, so a no-op where columns already exist.
"""
import sqlalchemy as sa
from alembic import op

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None

_TABLES = [
    "respondent_roster",
    "shared_files",
    "form_assignments",
    "programs",
    "program_locations",
    "program_participant_types",
    "program_questionnaires",
    "questionnaire_location_targets",
    "locations",
    "scheduled_reports",
    "webhooks",
    "submission_comments",
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
