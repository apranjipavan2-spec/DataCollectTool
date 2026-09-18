"""Add active_forms_limit, ai_reports_per_month, api_calls_per_month to plans;
add api_calls_used to usage_records.
"""
import sqlalchemy as sa
from alembic import op

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("plans", sa.Column("active_forms_limit",   sa.Integer(), nullable=True))
    op.add_column("plans", sa.Column("ai_reports_per_month", sa.Integer(), nullable=True))
    op.add_column("plans", sa.Column("api_calls_per_month",  sa.Integer(), nullable=True))

    op.add_column(
        "usage_records",
        sa.Column("api_calls_used", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade():
    op.drop_column("usage_records", "api_calls_used")
    op.drop_column("plans", "api_calls_per_month")
    op.drop_column("plans", "ai_reports_per_month")
    op.drop_column("plans", "active_forms_limit")
