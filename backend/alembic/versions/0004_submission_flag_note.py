"""Add flag_note column to submissions

Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('submissions', sa.Column('flag_note', sa.String(), nullable=True))


def downgrade():
    op.drop_column('submissions', 'flag_note')
