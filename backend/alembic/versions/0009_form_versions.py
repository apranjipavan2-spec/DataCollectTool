"""Add form_versions table for schema version history

Revision ID: 0009
Revises: 0008
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "form_versions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "form_id",
            UUID(as_uuid=True),
            sa.ForeignKey("forms.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("json_schema", sa.dialects.postgresql.JSONB, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("form_id", "version", name="uq_form_versions_form_version"),
    )
    op.create_index("ix_form_versions_form_id", "form_versions", ["form_id"])

    # Back-fill: snapshot each existing form's current schema as version 1.
    # Uses raw SQL so the migration works even if the ORM models change later.
    op.execute(
        """
        INSERT INTO form_versions (id, form_id, version, json_schema, created_at)
        SELECT gen_random_uuid(), id, version, json_schema, COALESCE(created_at, now())
        FROM forms
        """
    )


def downgrade():
    op.drop_index("ix_form_versions_form_id")
    op.drop_table("form_versions")
