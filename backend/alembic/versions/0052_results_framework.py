"""Add results-framework tables: logframe_levels, indicators, indicator_values

Revision ID: 0052
Revises: 0051
Create Date: 2026-09-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None


def _exists(conn, table_name: str) -> bool:
    return bool(conn.execute(sa.text(
        "SELECT 1 FROM information_schema.tables WHERE table_name=:t"
    ), {"t": table_name}).fetchone())


def upgrade():
    conn = op.get_bind()

    if not _exists(conn, "logframe_levels"):
        op.create_table(
            "logframe_levels",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
            sa.Column("program_id", UUID(as_uuid=True), sa.ForeignKey("programs.id", ondelete="CASCADE"), nullable=False),
            sa.Column("parent_id", UUID(as_uuid=True), sa.ForeignKey("logframe_levels.id", ondelete="SET NULL"), nullable=True),
            sa.Column("level_type", sa.String(20), nullable=False),  # goal|outcome|output|activity
            sa.Column("title", sa.Text(), nullable=False),
            sa.Column("description", sa.Text(), server_default=""),
            sa.Column("sort_order", sa.Integer(), server_default="0"),
            sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
            sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        )
        op.create_index("ix_logframe_levels_program", "logframe_levels", ["program_id", "tenant_id"])
        op.create_index("ix_logframe_levels_parent", "logframe_levels", ["parent_id"])

    if not _exists(conn, "indicators"):
        op.create_table(
            "indicators",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
            sa.Column("program_id", UUID(as_uuid=True), sa.ForeignKey("programs.id", ondelete="CASCADE"), nullable=False),
            sa.Column("logframe_level_id", UUID(as_uuid=True), sa.ForeignKey("logframe_levels.id", ondelete="CASCADE"), nullable=False),
            sa.Column("code", sa.String(50), server_default=""),
            sa.Column("name", sa.Text(), nullable=False),
            sa.Column("unit", sa.String(20), server_default="count"),        # count|percent|ratio|mean|text
            sa.Column("direction", sa.String(10), server_default="increase"),  # increase|decrease
            sa.Column("disaggregate_by", JSONB(), server_default="[]"),      # ["sex","age_band"]
            # auto-compute mapping (ignored when value_source=manual)
            sa.Column("source_form_field", sa.String(200), nullable=True),
            sa.Column("aggregation", sa.String(20), server_default="count"),  # count|sum|mean|percent
            sa.Column("numerator_filter", JSONB(), nullable=True),   # {"field": "...", "equals": "..."}
            sa.Column("denominator_filter", JSONB(), nullable=True),
            sa.Column("value_source", sa.String(10), server_default="auto"),  # auto|manual
            sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
            sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        )
        op.create_index("ix_indicators_program", "indicators", ["program_id", "tenant_id"])
        op.create_index("ix_indicators_level", "indicators", ["logframe_level_id"])

    if not _exists(conn, "indicator_values"):
        op.create_table(
            "indicator_values",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
            sa.Column("indicator_id", UUID(as_uuid=True), sa.ForeignKey("indicators.id", ondelete="CASCADE"), nullable=False),
            sa.Column("questionnaire_id", UUID(as_uuid=True), sa.ForeignKey("program_questionnaires.id", ondelete="CASCADE"), nullable=False),
            sa.Column("disaggregation", JSONB(), server_default="{}"),  # {} = total row
            sa.Column("target_value", sa.Float(), nullable=True),
            sa.Column("actual_value", sa.Float(), nullable=True),
            sa.Column("numerator", sa.Float(), nullable=True),
            sa.Column("denominator", sa.Float(), nullable=True),
            sa.Column("value_source", sa.String(10), server_default="auto"),  # auto|manual
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("computed_at", sa.TIMESTAMP(timezone=True), nullable=True),
            sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        )
        op.create_index("ix_indicator_values_indicator_wave", "indicator_values", ["indicator_id", "questionnaire_id"])


def downgrade():
    op.drop_table("indicator_values")
    op.drop_table("indicators")
    op.drop_table("logframe_levels")
