"""Add schedules table

Revision ID: 0008
Revises: 0007
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "schedules",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("form_id", UUID(as_uuid=True), sa.ForeignKey("forms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("enumerator_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("start_date", sa.Date, nullable=False),
        sa.Column("end_date", sa.Date, nullable=False),
        sa.Column("location", sa.String, default=""),
        sa.Column("target_count", sa.Integer, default=0),
        sa.Column("notes", sa.Text, default=""),
        sa.Column("status", sa.String, default="upcoming"),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_schedules_tenant_enum", "schedules", ["tenant_id", "enumerator_id"])
    op.create_index("ix_schedules_status", "schedules", ["status"])


def downgrade():
    op.drop_index("ix_schedules_status")
    op.drop_index("ix_schedules_tenant_enum")
    op.drop_table("schedules")
