"""Extend the 360-day soft-delete bin to forms and analyzer/cleaner projects.

Both were already being "deleted" via a status/archived_at flag but were
never wired into the shared deleted_at/Bin registry, so discarded forms and
projects vanished from the app with no way to see or restore them. Add
deleted_at and backfill it from the existing archive signal so already-
discarded items show up in the Bin immediately.

Idempotent — safe to re-run.
"""
import sqlalchemy as sa
from alembic import op

revision = "0062"
down_revision = "0061"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE forms ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"))
    conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_forms_deleted_at ON forms (deleted_at)"))
    conn.execute(sa.text("ALTER TABLE user_tool_projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_user_tool_projects_deleted_at ON user_tool_projects (deleted_at)"
    ))

    # Backfill: forms/projects already discarded before this migration existed
    # should show up in the Bin right away, not just newly-deleted ones.
    conn.execute(sa.text(
        "UPDATE forms SET deleted_at = COALESCE(updated_at, created_at, now()) "
        "WHERE status = 'archived' AND deleted_at IS NULL"
    ))
    conn.execute(sa.text(
        "UPDATE user_tool_projects SET deleted_at = archived_at "
        "WHERE archived_at IS NOT NULL AND deleted_at IS NULL"
    ))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("DROP INDEX IF EXISTS ix_forms_deleted_at"))
    conn.execute(sa.text("ALTER TABLE forms DROP COLUMN IF EXISTS deleted_at"))
    conn.execute(sa.text("DROP INDEX IF EXISTS ix_user_tool_projects_deleted_at"))
    conn.execute(sa.text("ALTER TABLE user_tool_projects DROP COLUMN IF EXISTS deleted_at"))
