"""Add folder/display_name to shared_files, shared_with_tenants to user_tool_projects."""
import sqlalchemy as sa
from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    # shared_files was never created by a migration — on the existing DB it
    # exists only because seed_dev.py's Base.metadata.create_all() made it as
    # a side effect. On a fresh database that side effect hasn't happened yet
    # (seed_dev.py runs after `alembic upgrade head`), so create it here first.
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS shared_files (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            uploaded_by UUID NOT NULL REFERENCES users(id),
            filename VARCHAR NOT NULL,
            original_filename VARCHAR NOT NULL,
            mime_type VARCHAR,
            file_size_bytes INTEGER,
            description TEXT DEFAULT '',
            disk_path VARCHAR NOT NULL,
            shared_with_tenants UUID[] DEFAULT '{}',
            is_global BOOLEAN DEFAULT false,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """))
    conn.execute(sa.text("ALTER TABLE shared_files ADD COLUMN IF NOT EXISTS folder VARCHAR DEFAULT ''"))
    conn.execute(sa.text("ALTER TABLE shared_files ADD COLUMN IF NOT EXISTS display_name VARCHAR DEFAULT ''"))
    conn.execute(sa.text("ALTER TABLE user_tool_projects ADD COLUMN IF NOT EXISTS shared_with_tenants UUID[] DEFAULT '{}'"))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE shared_files DROP COLUMN IF EXISTS folder"))
    conn.execute(sa.text("ALTER TABLE shared_files DROP COLUMN IF EXISTS display_name"))
    conn.execute(sa.text("ALTER TABLE user_tool_projects DROP COLUMN IF EXISTS shared_with_tenants"))
