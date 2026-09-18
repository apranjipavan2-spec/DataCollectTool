"""Per-form and per-program enumerator edit override

Revision ID: 0031
Revises: 0030
Create Date: 2026-04-27
"""
from alembic import op
import sqlalchemy as sa

revision = '0031'
down_revision = '0030'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    # IF NOT EXISTS guards against columns that were applied manually on production
    conn.execute(sa.text("ALTER TABLE forms    ADD COLUMN IF NOT EXISTS allow_enumerator_edit BOOLEAN"))
    conn.execute(sa.text("ALTER TABLE programs ADD COLUMN IF NOT EXISTS allow_enumerator_edit BOOLEAN"))


def downgrade():
    op.drop_column('forms',    'allow_enumerator_edit')
    op.drop_column('programs', 'allow_enumerator_edit')
