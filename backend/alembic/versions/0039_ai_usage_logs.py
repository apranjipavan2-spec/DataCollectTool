"""Add ai_usage_logs table for tracking per-user AI API consumption."""
import sqlalchemy as sa
from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS ai_usage_logs (
            id            BIGSERIAL PRIMARY KEY,
            tenant_id     UUID        NOT NULL,
            user_id       UUID,
            feature       VARCHAR(64) NOT NULL,
            provider      VARCHAR(32) NOT NULL,
            model         VARCHAR(64),
            tokens_in     INTEGER     DEFAULT 0,
            tokens_out    INTEGER     DEFAULT 0,
            success       BOOLEAN     DEFAULT TRUE,
            error         TEXT,
            created_at    TIMESTAMPTZ DEFAULT now()
        )
    """))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_created "
        "ON ai_usage_logs(tenant_id, created_at DESC)"
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created "
        "ON ai_usage_logs(user_id, created_at DESC)"
    ))


def downgrade():
    op.execute("DROP TABLE IF EXISTS ai_usage_logs")
