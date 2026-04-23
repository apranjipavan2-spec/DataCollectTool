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
    op.add_column('submissions', sa.Column('roster_id', pg.UUID(as_uuid=True), sa.ForeignKey('respondent_roster.id'), nullable=True))
    op.add_column('respondent_roster', sa.Column('extra_data', pg.JSONB(), server_default="'{}'::jsonb", nullable=True))


def downgrade():
    op.drop_column('submissions', 'roster_id')
    op.drop_column('respondent_roster', 'extra_data')
