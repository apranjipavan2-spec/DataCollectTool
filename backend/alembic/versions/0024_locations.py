"""Add locations table and link roster to locations

Revision ID: 0024
Revises: 0023
Create Date: 2026-04-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = '0024'
down_revision = '0023'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS locations (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES tenants(id),
            name VARCHAR(255) NOT NULL,
            type VARCHAR(50) NOT NULL,
            parent_id UUID REFERENCES locations(id),
            code VARCHAR(100),
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("ALTER TABLE respondent_roster ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id)")


def downgrade():
    op.drop_column('respondent_roster', 'location_id')
    op.drop_table('locations')
