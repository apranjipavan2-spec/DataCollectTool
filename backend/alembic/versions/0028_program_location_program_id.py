"""Add program_id to program_locations

Revision ID: 0028
Revises: 0027
Create Date: 2026-04-26
"""
from alembic import op

revision = '0028'
down_revision = '0027'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE program_locations "
        "ADD COLUMN IF NOT EXISTS program_id UUID REFERENCES programs(id) ON DELETE CASCADE"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_program_locations_program_id "
        "ON program_locations (program_id, tenant_id)"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_program_locations_program_id")
    op.execute("ALTER TABLE program_locations DROP COLUMN IF EXISTS program_id")
