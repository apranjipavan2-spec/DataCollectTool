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
    op.add_column('forms',    sa.Column('allow_enumerator_edit', sa.Boolean(), nullable=True))
    op.add_column('programs', sa.Column('allow_enumerator_edit', sa.Boolean(), nullable=True))


def downgrade():
    op.drop_column('forms',    'allow_enumerator_edit')
    op.drop_column('programs', 'allow_enumerator_edit')
