"""Add failed_login_count / locked_until to users — DPDP/CERT-In login
lockout after repeated failed attempts (item 16's "login rate limiting +
lockout" — request-rate limiting already existed via slowapi, this adds
actual per-account lockout).

Idempotent — safe to re-run.
"""
import sqlalchemy as sa
from alembic import op

revision = "0060"
down_revision = "0059"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0"
    ))
    conn.execute(sa.text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ"
    ))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS locked_until"))
    conn.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS failed_login_count"))
