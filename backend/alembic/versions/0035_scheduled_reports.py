"""Scheduled report delivery

Revision ID: 0035
Revises: 0034
Create Date: 2026-05-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '0035'
down_revision = '0034'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'scheduled_reports',
        sa.Column('id',         UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id',  UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by', UUID(as_uuid=True), sa.ForeignKey('users.id',   ondelete='CASCADE'), nullable=False),
        sa.Column('name',       sa.String,  nullable=False),
        sa.Column('program_id', UUID(as_uuid=True), sa.ForeignKey('programs.id', ondelete='SET NULL'), nullable=True),
        sa.Column('style',      sa.String,  nullable=False, server_default='field_survey'),
        sa.Column('custom_context', sa.Text, nullable=True, server_default=''),
        sa.Column('frequency',  sa.String,  nullable=False, server_default='weekly'),
        sa.Column('send_hour',  sa.String,  nullable=False, server_default='7'),
        sa.Column('send_dow',   sa.String,  nullable=True),
        sa.Column('recipient_emails', JSONB, nullable=False, server_default='[]'),
        sa.Column('is_active',  sa.Boolean, nullable=False, server_default='true'),
        sa.Column('last_sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    op.create_index('ix_scheduled_reports_tenant', 'scheduled_reports', ['tenant_id'])


def downgrade():
    op.drop_table('scheduled_reports')
