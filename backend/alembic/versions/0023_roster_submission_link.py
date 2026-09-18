"""Link submissions to roster entries; add CSV columns to roster

Revision ID: 0023
Revises: 0022
Create Date: 2026-04-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = '0023'
down_revision = '0022'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE submissions ADD COLUMN IF NOT EXISTS roster_id UUID REFERENCES respondent_roster(id)")
    op.execute("ALTER TABLE respondent_roster ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}'::jsonb")


def downgrade():
    op.drop_column('submissions', 'roster_id')
    op.drop_column('respondent_roster', 'extra_data')
