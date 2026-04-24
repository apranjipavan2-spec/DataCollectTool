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
    op.add_column('program_questionnaires',
        sa.Column('wave_number', sa.Integer(), nullable=True))
    op.add_column('program_questionnaires',
        sa.Column('wave_label', sa.String(100), nullable=True))
    op.add_column('program_questionnaires',
        sa.Column('panel_key', sa.String(200), nullable=True))

    op.add_column('programs',
        sa.Column('is_panel_study', sa.Boolean(), nullable=True, server_default='false'))

    op.add_column('submissions',
        sa.Column('household_id', sa.String(500), nullable=True))
    op.create_index('ix_submissions_household_id', 'submissions', ['household_id', 'tenant_id'])


def downgrade():
    op.drop_index('ix_submissions_household_id', 'submissions')
    op.drop_column('submissions', 'household_id')
    op.drop_column('programs', 'is_panel_study')
    op.drop_column('program_questionnaires', 'panel_key')
    op.drop_column('program_questionnaires', 'wave_label')
    op.drop_column('program_questionnaires', 'wave_number')
