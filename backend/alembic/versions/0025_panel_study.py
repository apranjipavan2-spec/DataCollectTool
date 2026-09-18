"""Add panel study support: wave fields on questionnaires, household_id on submissions

Revision ID: 0025
Revises: 0024
Create Date: 2026-04-23
"""
from alembic import op
import sqlalchemy as sa

revision = '0025'
down_revision = '0024'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE program_questionnaires ADD COLUMN IF NOT EXISTS wave_number INTEGER")
    op.execute("ALTER TABLE program_questionnaires ADD COLUMN IF NOT EXISTS wave_label VARCHAR(100)")
    op.execute("ALTER TABLE program_questionnaires ADD COLUMN IF NOT EXISTS panel_key VARCHAR(200)")
    op.execute("ALTER TABLE programs ADD COLUMN IF NOT EXISTS is_panel_study BOOLEAN DEFAULT false")
    op.execute("ALTER TABLE submissions ADD COLUMN IF NOT EXISTS household_id VARCHAR(500)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_submissions_household_id ON submissions (household_id, tenant_id)")


def downgrade():
    op.drop_index('ix_submissions_household_id', 'submissions')
    op.drop_column('submissions', 'household_id')
    op.drop_column('programs', 'is_panel_study')
    op.drop_column('program_questionnaires', 'panel_key')
    op.drop_column('program_questionnaires', 'wave_label')
    op.drop_column('program_questionnaires', 'wave_number')
