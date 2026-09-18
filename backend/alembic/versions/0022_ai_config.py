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
    op.execute("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_config JSONB DEFAULT '{}'::jsonb")


def downgrade():
    op.drop_column('tenants', 'ai_config')
