"""Backfill Submission.program_id/questionnaire_id/participant_type_id.

The main web submission-creation route (POST /submissions/) never set these
columns — only the offline sync path did — so submissions collected through
that route silently vanish from every program-filtered query (program
export, analyzer, program dashboards) even though the data itself is fine.
The route is now fixed (derives them from the form's ProgramQuestionnaire
link at creation time); this migration repairs existing rows the same way.

Data-only — no schema change, so there's nothing for wait_and_stamp.py's
column/table-existence ladder to detect, and nothing for seed_dev.py's
_PATCHES to replicate (a fresh seeded DB never has NULL program_id rows).
Idempotent — re-running only touches rows still missing program_id.
"""
import sqlalchemy as sa
from alembic import op

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE submissions s
        SET program_id = pq.program_id,
            questionnaire_id = pq.id,
            participant_type_id = pq.participant_type_id
        FROM program_questionnaires pq
        WHERE s.form_id = pq.form_id
          AND s.tenant_id = pq.tenant_id
          AND s.program_id IS NULL
    """))


def downgrade():
    # Backfilled data can't be un-derived safely (some rows may have had a
    # legitimately NULL program_id before this ran) — no-op.
    pass
