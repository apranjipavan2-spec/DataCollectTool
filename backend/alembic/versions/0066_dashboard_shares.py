"""Add dashboard_shares — read-only, aggregate-only results links a form's org
can hand to outsiders (donors, partners). Holds no submission data; the public
endpoint computes suppressed totals on read. Tenant-isolation RLS as in 0059.

Idempotent — safe to re-run.
"""
import sqlalchemy as sa
from alembic import op

revision = "0066"
down_revision = "0065"
branch_labels = None
depends_on = None

_UNSET = "COALESCE(current_setting('app.current_tenant', true), '') = ''"
_MATCH = "tenant_id::text = current_setting('app.current_tenant', true)"


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS dashboard_shares (
            id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
            token VARCHAR(64) NOT NULL UNIQUE,
            label VARCHAR(200),
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            expires_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ,
            view_count INTEGER NOT NULL DEFAULT 0,
            last_viewed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """))
    conn.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_dashboard_shares_form_id ON dashboard_shares (form_id)"))
    conn.execute(sa.text("ALTER TABLE dashboard_shares ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE dashboard_shares FORCE ROW LEVEL SECURITY"))
    conn.execute(sa.text("DROP POLICY IF EXISTS tenant_isolation ON dashboard_shares"))
    using = f"{_UNSET} OR {_MATCH}"
    conn.execute(sa.text(
        f"CREATE POLICY tenant_isolation ON dashboard_shares USING ({using}) WITH CHECK ({using})"
    ))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("DROP TABLE IF EXISTS dashboard_shares"))
