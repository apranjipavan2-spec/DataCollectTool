"""Add ai_config JSONB to tenants

Revision ID: 0022
Revises: 0021
Create Date: 2026-04-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0022'
down_revision = '0021'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('tenants', sa.Column('ai_config', JSONB(), server_default="'{}'::jsonb", nullable=True))


def downgrade():
    op.drop_column('tenants', 'ai_config')
