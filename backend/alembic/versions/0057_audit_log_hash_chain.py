"""Add tamper-evidence to audit_log: row_hash + prev_hash form a per-tenant
hash chain (each row's hash covers its own content plus the previous row's
hash), so editing or deleting a historical row breaks the chain — detectable
via app.services.audit.verify_audit_chain().

Rows written before this migration have row_hash/prev_hash = NULL (there is
no way to retroactively prove their original content was untampered, so
verification only covers rows written after this ships — documented, not
backfilled with false confidence).

Idempotent — a no-op where the columns/index already exist.
"""
import sqlalchemy as sa
from alembic import op

revision = "0057"
down_revision = "0056"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text(
        "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS row_hash VARCHAR(64)"
    ))
    conn.execute(sa.text(
        "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash VARCHAR(64)"
    ))
    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_audit_log_tenant_id_id ON audit_log (tenant_id, id)"
    ))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("DROP INDEX IF EXISTS ix_audit_log_tenant_id_id"))
    conn.execute(sa.text("ALTER TABLE audit_log DROP COLUMN IF EXISTS prev_hash"))
    conn.execute(sa.text("ALTER TABLE audit_log DROP COLUMN IF EXISTS row_hash"))
