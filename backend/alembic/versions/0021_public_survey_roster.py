"""Add public_token + is_public to forms; create respondent_roster table

Revision ID: 0021
Revises: 0020
Create Date: 2026-04-23
"""
from alembic import op
import sqlalchemy as sa
import sqlalchemy.dialects.postgresql as pg

revision = '0021'
down_revision = '0020'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE forms ADD COLUMN IF NOT EXISTS public_token VARCHAR(64)")
    op.execute("ALTER TABLE forms ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false")
    op.execute("""
        CREATE TABLE IF NOT EXISTS respondent_roster (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            form_id UUID NOT NULL REFERENCES forms(id),
            tenant_id UUID NOT NULL REFERENCES tenants(id),
            name VARCHAR(255) NOT NULL,
            phone VARCHAR(50),
            address TEXT,
            target_enumerator_id UUID REFERENCES users(id),
            status VARCHAR(20) DEFAULT 'pending',
            scheduled_date DATE,
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """)


def downgrade():
    op.drop_table('respondent_roster')
    op.drop_column('forms', 'is_public')
    op.drop_column('forms', 'public_token')
