"""Composite index on (tenant_id, form_id) for fast submission list queries

Revision ID: 0033
Revises: 0032
Create Date: 2026-04-28
"""
from alembic import op

revision = '0033'
down_revision = '0032'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_tenant_form
          ON submissions (tenant_id, form_id)
    """)


def downgrade():
    op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_sub_tenant_form")
