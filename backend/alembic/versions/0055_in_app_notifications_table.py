"""Create in_app_notifications (same missing-migration bug class as submission_comments
was — only ever created lazily by inbox.py's _ensure_table(). Doesn't currently break the
migration chain since nothing ALTERs it, but give it a real migration/model for
consistency and so a fresh DB doesn't depend on request-time table creation.

Revision ID: 0055
Revises: 0054
Create Date: 2026-09-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    exists = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.tables WHERE table_name='in_app_notifications'"
    )).fetchone()
    if exists:
        return
    op.create_table(
        "in_app_notifications",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipient_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(50), nullable=False, server_default="info"),
        sa.Column("title", sa.String(200), nullable=False, server_default=""),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("link", sa.String(500), nullable=False, server_default=""),
        sa.Column("read", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_inbox_recipient", "in_app_notifications", ["recipient_id", "read", "created_at"])


def downgrade():
    op.drop_index("idx_inbox_recipient", "in_app_notifications")
    op.drop_table("in_app_notifications")
