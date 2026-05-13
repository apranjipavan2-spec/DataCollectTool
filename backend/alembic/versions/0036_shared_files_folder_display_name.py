"""Add folder/display_name to shared_files, shared_with_tenants to user_tool_projects."""
import sqlalchemy as sa
from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE shared_files ADD COLUMN IF NOT EXISTS folder VARCHAR DEFAULT ''"))
    conn.execute(sa.text("ALTER TABLE shared_files ADD COLUMN IF NOT EXISTS display_name VARCHAR DEFAULT ''"))
    conn.execute(sa.text("ALTER TABLE user_tool_projects ADD COLUMN IF NOT EXISTS shared_with_tenants UUID[] DEFAULT '{}'"))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE shared_files DROP COLUMN IF EXISTS folder"))
    conn.execute(sa.text("ALTER TABLE shared_files DROP COLUMN IF EXISTS display_name"))
    conn.execute(sa.text("ALTER TABLE user_tool_projects DROP COLUMN IF EXISTS shared_with_tenants"))
