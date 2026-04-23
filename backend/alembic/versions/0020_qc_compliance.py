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
    op.add_column('submissions', sa.Column('has_violations', sa.Boolean(), nullable=True, server_default=sa.text('false')))
    op.add_column('submissions', sa.Column('consent_given', sa.Boolean(), nullable=True, server_default=sa.text('true')))
    op.add_column('submissions', sa.Column('consent_timestamp', sa.DateTime(timezone=True), nullable=True))
    op.add_column('submissions', sa.Column('backcheck_required', sa.Boolean(), nullable=True, server_default=sa.text('false')))
    op.add_column('submissions', sa.Column('backcheck_form_id', UUID(as_uuid=True), nullable=True))


def downgrade():
    op.drop_column('submissions', 'backcheck_form_id')
    op.drop_column('submissions', 'backcheck_required')
    op.drop_column('submissions', 'consent_timestamp')
    op.drop_column('submissions', 'consent_given')
    op.drop_column('submissions', 'has_violations')
