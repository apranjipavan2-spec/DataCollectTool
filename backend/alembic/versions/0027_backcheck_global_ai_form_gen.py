"""backcheck completion, global ai config, form generation status

Revision ID: 0027
Revises: 0026
Create Date: 2026-04-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0027'
down_revision = '0026'
branch_labels = None
depends_on = None


def upgrade():
    # Back-check completion tracking
    op.add_column('submissions', sa.Column('backcheck_completed', sa.Boolean(), nullable=True, server_default='false'))

    # Global AI config (one row per key, shared across all tenants)
    op.create_table(
        'system_settings',
        sa.Column('key', sa.Text(), primary_key=True),
        sa.Column('value', JSONB(), nullable=False, server_default='{}'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.execute("INSERT INTO system_settings (key, value) VALUES ('ai_config', '{}') ON CONFLICT DO NOTHING")

    # AI form generation status
    op.add_column('forms', sa.Column('generation_status', sa.Text(), nullable=True, server_default='done'))
    op.add_column('forms', sa.Column('generation_error', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('submissions', 'backcheck_completed')
    op.drop_table('system_settings')
    op.drop_column('forms', 'generation_status')
    op.drop_column('forms', 'generation_error')
