"""Bring data_rights_requests under the same tenant-isolation RLS policy as
every other strict-tenant table (see 0048). It's a new table created after
0048 ran, so it never got RLS enabled — without this it would be the one
tenant-scoped table with no DB-layer defense-in-depth, relying purely on
every route remembering .filter(tenant_id==...), exactly the gap 0048 closed
for everything else. fieldgovern_app already has DML on it via 0048's
ALTER DEFAULT PRIVILEGES; this migration only adds RLS enable/force + policy.

Idempotent — safe to re-run.
"""
import sqlalchemy as sa
from alembic import op

revision = "0059"
down_revision = "0058"
branch_labels = None
depends_on = None

_UNSET = "COALESCE(current_setting('app.current_tenant', true), '') = ''"
_MATCH = "tenant_id::text = current_setting('app.current_tenant', true)"
_TABLE = "data_rights_requests"


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text(f"ALTER TABLE {_TABLE} ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text(f"ALTER TABLE {_TABLE} FORCE ROW LEVEL SECURITY"))
    conn.execute(sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {_TABLE}"))
    using = f"{_UNSET} OR {_MATCH}"
    conn.execute(sa.text(
        f"CREATE POLICY tenant_isolation ON {_TABLE} USING ({using}) WITH CHECK ({using})"
    ))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {_TABLE}"))
    conn.execute(sa.text(f"ALTER TABLE {_TABLE} NO FORCE ROW LEVEL SECURITY"))
    conn.execute(sa.text(f"ALTER TABLE {_TABLE} DISABLE ROW LEVEL SECURITY"))
