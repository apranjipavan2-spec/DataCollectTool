"""QC and DPDP compliance columns for submissions

Revision ID: 0020
Revises: 0019
Create Date: 2026-04-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0020'
down_revision = '0019'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE submissions ADD COLUMN IF NOT EXISTS has_violations BOOLEAN DEFAULT false")
    op.execute("ALTER TABLE submissions ADD COLUMN IF NOT EXISTS consent_given BOOLEAN DEFAULT true")
    op.execute("ALTER TABLE submissions ADD COLUMN IF NOT EXISTS consent_timestamp TIMESTAMPTZ")
    op.execute("ALTER TABLE submissions ADD COLUMN IF NOT EXISTS backcheck_required BOOLEAN DEFAULT false")
    op.execute("ALTER TABLE submissions ADD COLUMN IF NOT EXISTS backcheck_form_id UUID")


def downgrade():
    op.drop_column('submissions', 'backcheck_form_id')
    op.drop_column('submissions', 'backcheck_required')
    op.drop_column('submissions', 'consent_timestamp')
    op.drop_column('submissions', 'consent_given')
    op.drop_column('submissions', 'has_violations')
