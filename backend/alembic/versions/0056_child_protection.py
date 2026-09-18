"""Add submissions.is_minor + guardian_consent_given for DPDP children's-data
protection (Rule on verifiable guardian consent for respondents under 18).

Computed server-side at submission time (both POST /submissions/ and the
offline POST /sync/push path) from any form field marked is_dob_for_screening
(age computed against today) and is_guardian_consent (a truthy answer) —
see backend/app/services/child_protection.py. Neither flag exists unless a
form actually declares those fields; is_minor defaults false so ordinary
adult-respondent forms are entirely unaffected.

is_minor is used to (a) exclude the submission from AI report/tabulation
data pulls by default, (b) hide it from the default submissions list for
everyone except org_admin/supervisor/master_admin (see submissions.py).

Idempotent — a no-op where the columns/index already exist.
"""
import sqlalchemy as sa
from alembic import op

revision = "0056"
down_revision = "0055"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text(
        "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS is_minor BOOLEAN NOT NULL DEFAULT FALSE"
    ))
    conn.execute(sa.text(
        "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS guardian_consent_given BOOLEAN"
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_submissions_is_minor ON submissions (is_minor)"
    ))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("DROP INDEX IF EXISTS ix_submissions_is_minor"))
    conn.execute(sa.text("ALTER TABLE submissions DROP COLUMN IF EXISTS guardian_consent_given"))
    conn.execute(sa.text("ALTER TABLE submissions DROP COLUMN IF EXISTS is_minor"))
