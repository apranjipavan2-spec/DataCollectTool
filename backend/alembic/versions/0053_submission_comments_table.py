"""Create submission_comments (never had a migration — was only ever created at runtime
by comments.py's _ensure_table(), which breaks a from-scratch migration replay because
migration 0046 tries to ALTER a table that doesn't exist yet in that history).

Revision ID: 0053
Revises: 0052
Create Date: 2026-09-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0053"
down_revision = "0052"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    exists = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.tables WHERE table_name='submission_comments'"
    )).fetchone()
    if exists:
        return
    op.create_table(
        "submission_comments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("submission_id", UUID(as_uuid=True), sa.ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", UUID(as_uuid=True), nullable=False),
        sa.Column("author_name", sa.String(), nullable=False, server_default=""),
        sa.Column("author_role", sa.String(), nullable=False, server_default=""),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index("idx_comments_submission", "submission_comments", ["submission_id"])
    op.create_index("ix_submission_comments_deleted_at", "submission_comments", ["deleted_at"])


def downgrade():
    op.drop_index("ix_submission_comments_deleted_at", "submission_comments")
    op.drop_index("idx_comments_submission", "submission_comments")
    op.drop_table("submission_comments")
