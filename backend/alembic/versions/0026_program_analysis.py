"""Add program_analysis table for AI-generated and manual tabulation configs

Revision ID: 0026
Revises: 0025
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '0026'
down_revision = '0025'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    exists = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.tables WHERE table_name='program_analysis'"
    )).fetchone()
    if exists:
        return
    op.create_table(
        'program_analysis',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('program_id', UUID(as_uuid=True), sa.ForeignKey('programs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False),
        sa.Column('created_by', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()')),
        sa.Column('status', sa.Text(), server_default='done'),      # pending | done | failed
        sa.Column('source', sa.Text(), server_default='manual'),    # manual | ai
        sa.Column('objectives', sa.Text(), nullable=True),
        sa.Column('table_configs', JSONB(), server_default='[]'),
        sa.Column('cleaning_summary', JSONB(), server_default='{}'),
        sa.Column('ai_rationale', sa.Text(), nullable=True),
        sa.Column('error_text', sa.Text(), nullable=True),
        sa.Column('run_count', sa.Integer(), server_default='0'),
        sa.Column('last_run_at', sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index('ix_program_analysis_program_id', 'program_analysis', ['program_id', 'tenant_id'])


def downgrade():
    op.drop_index('ix_program_analysis_program_id', 'program_analysis')
    op.drop_table('program_analysis')
