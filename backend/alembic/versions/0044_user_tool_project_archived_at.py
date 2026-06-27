"""Add archived_at to user_tool_projects (soft-archive instead of delete).

Projects are never hard-deleted from the tool UI: archiving sets this
timestamp and the project drops out of the active list but stays restorable.
Idempotent (ADD COLUMN IF NOT EXISTS) so re-runs are safe.
"""
import sqlalchemy as sa
from alembic import op

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text(
        "ALTER TABLE user_tool_projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ"
    ))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text(
        "ALTER TABLE user_tool_projects DROP COLUMN IF EXISTS archived_at"
    ))
