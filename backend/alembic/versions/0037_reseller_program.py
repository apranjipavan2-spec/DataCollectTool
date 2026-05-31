"""Add reseller program fields to tenants."""
import sqlalchemy as sa
from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text(
        "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS reseller_code VARCHAR(32) UNIQUE"
    ))
    conn.execute(sa.text(
        "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referred_by_reseller_code VARCHAR(32)"
    ))
    conn.execute(sa.text(
        "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2) DEFAULT 20.00"
    ))
    conn.execute(sa.text(
        "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_reseller BOOLEAN DEFAULT FALSE"
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_tenants_reseller_code ON tenants(reseller_code) "
        "WHERE reseller_code IS NOT NULL"
    ))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("DROP INDEX IF EXISTS idx_tenants_reseller_code"))
    conn.execute(sa.text("ALTER TABLE tenants DROP COLUMN IF EXISTS reseller_code"))
    conn.execute(sa.text("ALTER TABLE tenants DROP COLUMN IF EXISTS referred_by_reseller_code"))
    conn.execute(sa.text("ALTER TABLE tenants DROP COLUMN IF EXISTS commission_rate"))
    conn.execute(sa.text("ALTER TABLE tenants DROP COLUMN IF EXISTS is_reseller"))
