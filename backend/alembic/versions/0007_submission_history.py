"""Create submission_history table for audit trail

Revision ID: 0007
Revises: 0006
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'submission_history',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('submission_id', UUID(as_uuid=True), sa.ForeignKey('submissions.id'), nullable=False, index=True),
        sa.Column('changed_by', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('old_data', JSONB, nullable=True),
        sa.Column('new_data', JSONB, nullable=True),
        sa.Column('note', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table('submission_history')
