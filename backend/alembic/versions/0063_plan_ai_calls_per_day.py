"""Add Plan.ai_calls_per_day — per-tier daily AI call cap.

Existing ai_reports_per_month covers the monthly ceiling; this adds a
finer-grained daily throttle (mainly to bound trial abuse cost) that the
super-admin can also tune per plan without a code deploy.

Idempotent — safe to re-run.
"""
import sqlalchemy as sa
from alembic import op

revision = "0063"
down_revision = "0062"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE plans ADD COLUMN IF NOT EXISTS ai_calls_per_day INTEGER"))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE plans DROP COLUMN IF EXISTS ai_calls_per_day"))
