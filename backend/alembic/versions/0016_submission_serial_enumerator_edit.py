"""Add serial_no to submissions and allow_enumerator_edit to tenants

Revision ID: 0016
Revises: 0015
Create Date: 2026-04-19
"""
from alembic import op
import sqlalchemy as sa

revision = '0016'
down_revision = '0015'
branch_labels = None
depends_on = None


def upgrade():
    # Serial number per submission, auto-assigned, admin-editable
    op.add_column('submissions', sa.Column('serial_no', sa.Integer(), nullable=True))

    # Tenant setting: allow enumerators to edit their own submissions (default True)
    op.add_column('tenants', sa.Column('allow_enumerator_edit', sa.Boolean(), nullable=False, server_default='true'))

    # Backfill serial_no for existing submissions (per tenant, ordered by server_received_at)
    op.execute("""
        WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY server_received_at ASC, id ASC) AS rn
            FROM submissions
        )
        UPDATE submissions s
        SET serial_no = r.rn
        FROM ranked r
        WHERE s.id = r.id
    """)


def downgrade():
    op.drop_column('submissions', 'serial_no')
    op.drop_column('tenants', 'allow_enumerator_edit')
