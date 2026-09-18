"""Add TOTP 2FA columns to users and audit_log table."""
import sqlalchemy as sa
from alembic import op

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    # 2FA columns on users
    conn.execute(sa.text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64)"
    ))
    conn.execute(sa.text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE"
    ))
    # Audit log table (append-only, never updated)
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id          BIGSERIAL PRIMARY KEY,
            tenant_id   UUID        NOT NULL,
            user_id     UUID,
            action      VARCHAR(64) NOT NULL,
            resource    VARCHAR(64),
            resource_id VARCHAR(128),
            detail      JSONB       DEFAULT '{}',
            ip_address  VARCHAR(45),
            created_at  TIMESTAMPTZ DEFAULT now()
        )
    """))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created "
        "ON audit_log(tenant_id, created_at DESC)"
    ))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS totp_secret"))
    conn.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS totp_enabled"))
    conn.execute(sa.text("DROP TABLE IF EXISTS audit_log"))
