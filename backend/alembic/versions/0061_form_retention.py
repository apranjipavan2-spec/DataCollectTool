"""Add forms.retention_days — per-form DPDP retention policy (item 23).
NULL means no automatic retention (current behavior, unchanged default).

Idempotent — safe to re-run.
"""
import sqlalchemy as sa
from alembic import op

revision = "0061"
down_revision = "0060"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text(
        "ALTER TABLE forms ADD COLUMN IF NOT EXISTS retention_days INTEGER"
    ))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE forms DROP COLUMN IF EXISTS retention_days"))
