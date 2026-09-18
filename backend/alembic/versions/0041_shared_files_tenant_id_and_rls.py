"""Defense-in-depth: tenant_id on shared_files, RLS on programs, user_tool_projects, shared_files.

Adds a `tenant_id` column to `shared_files`, backfills from the uploader's
home tenant (no row dropped), then makes it NOT NULL. Enables PostgreSQL
row-level security on the three tables that were previously only protected
by Python query filters.

All operations are idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS) so
re-running on a partially-applied DB is safe.
"""
import sqlalchemy as sa
from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


_RLS_TABLES = ("programs", "user_tool_projects", "shared_files")


def upgrade():
    conn = op.get_bind()

    # ── 1. shared_files.tenant_id ────────────────────────────────────────────
    conn.execute(sa.text("""
        ALTER TABLE shared_files
        ADD COLUMN IF NOT EXISTS tenant_id UUID
    """))

    # Backfill from uploader's home tenant. Uploaded_by is NOT NULL on this
    # table, so every row gets a value.
    conn.execute(sa.text("""
        UPDATE shared_files f
        SET    tenant_id = u.tenant_id
        FROM   users u
        WHERE  u.id = f.uploaded_by
          AND  f.tenant_id IS NULL
    """))

    # Any leftover rows (uploader deleted?) — adopt the platform/master tenant
    # as a safe parent so we can enforce NOT NULL. Pick the tenant of any
    # master_admin user as the parent; if no such user exists, pick any
    # tenant. This is a defensive fallback only.
    conn.execute(sa.text("""
        UPDATE shared_files
        SET    tenant_id = COALESCE(
                   (SELECT u.tenant_id FROM users u WHERE u.role='master_admin' LIMIT 1),
                   (SELECT id FROM tenants LIMIT 1)
               )
        WHERE  tenant_id IS NULL
    """))

    conn.execute(sa.text("""
        ALTER TABLE shared_files
        ALTER COLUMN tenant_id SET NOT NULL
    """))

    # Add FK + index. Use IF NOT EXISTS to keep re-runs clean.
    conn.execute(sa.text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'shared_files_tenant_id_fkey'
            ) THEN
                ALTER TABLE shared_files
                ADD CONSTRAINT shared_files_tenant_id_fkey
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
            END IF;
        END $$;
    """))

    conn.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS idx_shared_files_tenant ON shared_files(tenant_id)"
    ))

    # ── 2. Row-Level Security ────────────────────────────────────────────────
    # programs has no cross-tenant sharing mechanism — strict tenant isolation.
    conn.execute(sa.text("ALTER TABLE programs ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("ALTER TABLE programs FORCE ROW LEVEL SECURITY"))
    conn.execute(sa.text("DROP POLICY IF EXISTS tenant_isolation ON programs"))
    conn.execute(sa.text("""
        CREATE POLICY tenant_isolation ON programs
        USING      (tenant_id::text = current_setting('app.current_tenant', true))
        WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true))
    """))

    # user_tool_projects and shared_files support explicit cross-tenant sharing
    # via shared_with_tenants — read is allowed if owner-tenant OR shared,
    # but writes always require owner-tenant.
    for table in ("user_tool_projects", "shared_files"):
        conn.execute(sa.text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
        conn.execute(sa.text(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY"))
        conn.execute(sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {table}"))
        conn.execute(sa.text(f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (
                tenant_id::text = current_setting('app.current_tenant', true)
                OR current_setting('app.current_tenant', true)::uuid
                   = ANY(COALESCE(shared_with_tenants, ARRAY[]::uuid[]))
            )
            WITH CHECK (
                tenant_id::text = current_setting('app.current_tenant', true)
            )
        """))


def downgrade():
    conn = op.get_bind()
    for table in _RLS_TABLES:
        conn.execute(sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {table}"))
        conn.execute(sa.text(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY"))
        conn.execute(sa.text(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text("DROP INDEX IF EXISTS idx_shared_files_tenant"))
    conn.execute(sa.text(
        "ALTER TABLE shared_files DROP CONSTRAINT IF EXISTS shared_files_tenant_id_fkey"
    ))
    conn.execute(sa.text("ALTER TABLE shared_files DROP COLUMN IF EXISTS tenant_id"))
