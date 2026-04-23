"""Add locations table and link roster to locations

Revision ID: 0024
Revises: 0023
Create Date: 2026-04-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = '0024'
down_revision = '0023'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('locations',
        sa.Column('id', pg.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', pg.UUID(as_uuid=True), sa.ForeignKey('tenants.id'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('type', sa.String(50), nullable=False),
        sa.Column('parent_id', pg.UUID(as_uuid=True), sa.ForeignKey('locations.id'), nullable=True),
        sa.Column('code', sa.String(100), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )
    op.add_column('respondent_roster',
        sa.Column('location_id', pg.UUID(as_uuid=True), sa.ForeignKey('locations.id'), nullable=True))


def downgrade():
    op.drop_column('respondent_roster', 'location_id')
    op.drop_table('locations')
