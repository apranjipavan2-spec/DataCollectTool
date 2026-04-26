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


def _col_exists(conn, table, col):
    return conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": col}).fetchone() is not None

def _table_exists(conn, table):
    return conn.execute(sa.text(
        "SELECT 1 FROM information_schema.tables WHERE table_name=:t"
    ), {"t": table}).fetchone() is not None

def upgrade():
    conn = op.get_bind()

    if not _col_exists(conn, 'submissions', 'backcheck_completed'):
        op.add_column('submissions', sa.Column('backcheck_completed', sa.Boolean(), nullable=True, server_default='false'))

    if not _table_exists(conn, 'system_settings'):
        op.create_table(
            'system_settings',
            sa.Column('key', sa.Text(), primary_key=True),
            sa.Column('value', JSONB(), nullable=False, server_default='{}'),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
    op.execute("INSERT INTO system_settings (key, value) VALUES ('ai_config', '{}') ON CONFLICT DO NOTHING")

    if not _col_exists(conn, 'forms', 'generation_status'):
        op.add_column('forms', sa.Column('generation_status', sa.Text(), nullable=True, server_default='done'))
    if not _col_exists(conn, 'forms', 'generation_error'):
        op.add_column('forms', sa.Column('generation_error', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('submissions', 'backcheck_completed')
    op.drop_table('system_settings')
    op.drop_column('forms', 'generation_status')
    op.drop_column('forms', 'generation_error')
