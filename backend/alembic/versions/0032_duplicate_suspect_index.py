"""Partial index on data_json duplicate_suspect flag for fast JSONB filter

Revision ID: 0032
Revises: 0031
Create Date: 2026-04-27
"""
from alembic import op

revision = '0032'
down_revision = '0031'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_dup_suspect
          ON submissions ((data_json->>'_duplicate_suspect'))
          WHERE data_json->>'_duplicate_suspect' = 'true'
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_sub_dup_suspect")
