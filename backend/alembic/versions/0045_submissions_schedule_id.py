"""Add schedule_id to submissions.

The ORM model (app/models/submission.py) has declared this column since
schedules were added, but no migration ever created it — it only exists on
deployed databases because someone added it by hand. Idempotent, so this is
a no-op wherever the column is already there.
"""
import sqlalchemy as sa
from alembic import op

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text(
        "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES schedules(id) ON DELETE SET NULL"
    ))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE submissions DROP COLUMN IF EXISTS schedule_id"))
