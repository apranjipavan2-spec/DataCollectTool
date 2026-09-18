"""MEAL feedback module: programs.feedback_form_id pointer + feedback_resolutions table.

Revision ID: 0054
Revises: 0053
Create Date: 2026-09-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    conn.execute(sa.text(
        "ALTER TABLE programs ADD COLUMN IF NOT EXISTS feedback_form_id UUID "
        "REFERENCES forms(id) ON DELETE SET NULL"
    ))

    exists = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.tables WHERE table_name='feedback_resolutions'"
    )).fetchone()
    if exists:
        return
    op.create_table(
        "feedback_resolutions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("submission_id", UUID(as_uuid=True), sa.ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("status", sa.String(), server_default="open"),
        sa.Column("assigned_to", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column("resolved_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("resolved_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_feedback_resolutions_tenant", "feedback_resolutions", ["tenant_id", "status"])


def downgrade():
    op.drop_index("ix_feedback_resolutions_tenant", "feedback_resolutions")
    op.drop_table("feedback_resolutions")
    op.execute("ALTER TABLE programs DROP COLUMN IF EXISTS feedback_form_id")
