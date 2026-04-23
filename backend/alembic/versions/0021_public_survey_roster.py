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
    op.add_column('forms', sa.Column('public_token', sa.String(64), unique=True, nullable=True))
    op.add_column('forms', sa.Column('is_public', sa.Boolean(), server_default='false', nullable=True))
    op.create_table(
        'respondent_roster',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('form_id', pg.UUID(as_uuid=True), sa.ForeignKey('forms.id'), nullable=False),
        sa.Column('tenant_id', pg.UUID(as_uuid=True), sa.ForeignKey('tenants.id'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('phone', sa.String(50)),
        sa.Column('address', sa.Text()),
        sa.Column('target_enumerator_id', pg.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('status', sa.String(20), server_default='pending'),
        sa.Column('scheduled_date', sa.Date(), nullable=True),
        sa.Column('notes', sa.Text()),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table('respondent_roster')
    op.drop_column('forms', 'is_public')
    op.drop_column('forms', 'public_token')
