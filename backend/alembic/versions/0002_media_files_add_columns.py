"""Add field_name and mime_type columns to media_files

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('media_files', sa.Column('field_name', sa.String(), nullable=True))
    op.add_column('media_files', sa.Column('mime_type', sa.String(), nullable=True))
    op.create_index('ix_media_files_submission_field', 'media_files', ['submission_id', 'field_name'])


def downgrade():
    op.drop_index('ix_media_files_submission_field', table_name='media_files')
    op.drop_column('media_files', 'mime_type')
    op.drop_column('media_files', 'field_name')
