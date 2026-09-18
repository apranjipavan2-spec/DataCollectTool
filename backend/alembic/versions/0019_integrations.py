"""Add notification_config to tenants, sheets_sync_config to forms

Revision ID: 0019
Revises: 0018
Create Date: 2026-04-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0019'
down_revision = '0018'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('tenants', sa.Column(
        'notification_config', JSONB, nullable=True,
        server_default=sa.text("'{}'::jsonb")
    ))
    op.add_column('forms', sa.Column(
        'sheets_sync_config', JSONB, nullable=True,
        server_default=sa.text("'{}'::jsonb")
    ))


def downgrade():
    op.drop_column('tenants', 'notification_config')
    op.drop_column('forms', 'sheets_sync_config')
