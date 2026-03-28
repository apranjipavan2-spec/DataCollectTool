"""Add app_name column to tenants for white-labeling

Revision ID: 0013
Revises: 0012
"""
from alembic import op
import sqlalchemy as sa


revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tenants", sa.Column("app_name", sa.String, server_default=""))


def downgrade():
    op.drop_column("tenants", "app_name")
