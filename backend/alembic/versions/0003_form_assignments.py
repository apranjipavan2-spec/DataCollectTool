"""Create form_assignments table for multi-form assignment

Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'form_assignments',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('form_id', UUID(as_uuid=True), sa.ForeignKey('forms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('enumerator_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('assigned_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('assigned_by', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL')),
    )
    op.create_index('ix_fa_tenant', 'form_assignments', ['tenant_id'])
    op.create_index('ix_fa_enumerator', 'form_assignments', ['enumerator_id'])
    op.create_index('ix_fa_form', 'form_assignments', ['form_id'])
    # Unique constraint: one assignment per form+enumerator
    op.create_unique_constraint('uq_fa_form_enumerator', 'form_assignments', ['form_id', 'enumerator_id'])

    # RLS
    op.execute('ALTER TABLE form_assignments ENABLE ROW LEVEL SECURITY')
    op.execute("""
        CREATE POLICY tenant_isolation ON form_assignments
        USING (tenant_id = current_setting('app.current_tenant')::uuid)
    """)


def downgrade():
    op.execute('DROP POLICY IF EXISTS tenant_isolation ON form_assignments')
    op.drop_table('form_assignments')
