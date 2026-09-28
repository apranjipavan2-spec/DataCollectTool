"""Add system_metrics — per-minute CPU/RAM samples for the super-admin resource monitor.

Idempotent — safe to re-run.
"""
import sqlalchemy as sa
from alembic import op

revision = "0065"
down_revision = "0064"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS system_metrics (
            id BIGSERIAL PRIMARY KEY,
            ts TIMESTAMPTZ NOT NULL DEFAULT now(),
            cpu_pct DOUBLE PRECISION NOT NULL,
            mem_pct DOUBLE PRECISION NOT NULL,
            mem_used_mb DOUBLE PRECISION NOT NULL,
            mem_total_mb DOUBLE PRECISION NOT NULL
        )
    """))
    conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_system_metrics_ts ON system_metrics (ts)"))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("DROP TABLE IF EXISTS system_metrics"))
