"""Enforce tenant isolation at the DB layer: (1) complete the restricted runtime
role `fieldgovern_app`, (2) rewrite RLS policies so they are safe to run under it.

Background: the app connected as the Postgres bootstrap user (POSTGRES_USER, a
SUPERUSER). Superusers bypass ALL row-level security — even FORCE RLS — so the
tenant_isolation policies were dead weight in production; only the Python
.filter(tenant_id==...) calls kept clients apart. Migration 0001 created
`fieldgovern_app` but only granted DML on the 7 then-existing tables and set no
default privileges, so it was never usable and the switch was never made.

Two things are needed to make the restricted role work:

  1. Grants: `fieldgovern_app` needs DML on ALL tables + USAGE on sequences, and
     ALTER DEFAULT PRIVILEGES so future migrations auto-grant.

  2. Policies: the existing policies filter strictly on `app.current_tenant`. But
     several code paths legitimately run WITHOUT a tenant context and must still
     work under the restricted role:
       - pre-auth lookups (login, forgot/reset password, OTP, refresh) query
         `users` before any tenant is known;
       - public survey by-token endpoints look up `forms` and insert
         `submissions` with no logged-in user;
       - master_admin platform dashboards read across ALL tenants.
     So we rewrite every policy to: "if no tenant context is set, allow; else
     enforce strict tenant match." Authenticated tenant users ALWAYS have a real
     tenant uuid in context (set by get_current_user), so they still get strict
     isolation — the permissive branch only opens for the unset/platform paths,
     which is exactly how the superuser behaves today. master_admin is given an
     EMPTY context in get_current_user so its cross-tenant reads keep working.

Enable enforcement by pointing the app runtime at APP_DATABASE_URL (the
fieldgovern_app role). Migrations/seeds keep using the superuser DATABASE_URL.
Everything here is idempotent and safe to re-run.

ponytail: reuses the existing role + RLS rather than adding a second isolation
model or swapping the DB session on ~25 endpoints; the empty-context bypass keeps
the diff to two files and removes the login-lockout risk of the naive flip.
"""
import os
import sqlalchemy as sa
from alembic import op

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


# Tables whose only sharing rule is strict tenant match.
_STRICT_TABLES = (
    "users", "forms", "submissions", "media_files", "cleaning_flags",
    "sync_log", "form_assignments", "programs",
)
# Tables that also allow reads from tenants listed in shared_with_tenants.
_SHARED_TABLES = ("user_tool_projects", "shared_files")

# "No tenant context set" (unset -> NULL, or master_admin -> '') means bypass.
_UNSET = "COALESCE(current_setting('app.current_tenant', true), '') = ''"
_MATCH = "tenant_id::text = current_setting('app.current_tenant', true)"
# NULLIF avoids casting '' to uuid (which errors); '' and NULL both -> NULL -> no match.
_SHARED = ("NULLIF(current_setting('app.current_tenant', true), '')::uuid "
           "= ANY(COALESCE(shared_with_tenants, ARRAY[]::uuid[]))")


def _grants(conn):
    conn.execute(sa.text("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fieldgovern_app') THEN
                CREATE ROLE fieldgovern_app LOGIN NOINHERIT;
            END IF;
        END $$;
    """))
    conn.execute(sa.text(
        "ALTER ROLE fieldgovern_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE"
    ))
    app_pw = os.environ.get("APP_DB_PASSWORD")
    if app_pw:
        conn.execute(sa.text("ALTER ROLE fieldgovern_app PASSWORD :pw"), {"pw": app_pw})
    conn.execute(sa.text("GRANT USAGE ON SCHEMA public TO fieldgovern_app"))
    conn.execute(sa.text(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fieldgovern_app"
    ))
    conn.execute(sa.text(
        "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fieldgovern_app"
    ))
    conn.execute(sa.text(
        "ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public "
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fieldgovern_app"
    ))
    conn.execute(sa.text(
        "ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public "
        "GRANT USAGE, SELECT ON SEQUENCES TO fieldgovern_app"
    ))


def _policy(conn, table: str, using: str, check: str):
    # RLS must be ON and FORCEd (so it applies even to the table owner, since only
    # a superuser/BYPASSRLS role — which the app is not — can skip it).
    conn.execute(sa.text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
    conn.execute(sa.text(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY"))
    conn.execute(sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {table}"))
    conn.execute(sa.text(
        f"CREATE POLICY tenant_isolation ON {table} "
        f"USING ({using}) WITH CHECK ({check})"
    ))


def upgrade():
    conn = op.get_bind()
    _grants(conn)

    strict_using = f"{_UNSET} OR {_MATCH}"
    for t in _STRICT_TABLES:
        _policy(conn, t, using=strict_using, check=strict_using)

    for t in _SHARED_TABLES:
        _policy(
            conn, t,
            using=f"{_UNSET} OR {_MATCH} OR {_SHARED}",
            check=f"{_UNSET} OR {_MATCH}",
        )


def downgrade():
    # Restore strict policies (pre-0048 behavior) and revoke the extra grants.
    conn = op.get_bind()
    for t in _STRICT_TABLES:
        _policy(conn, t, using=_MATCH, check=_MATCH)
    for t in _SHARED_TABLES:
        _policy(conn, t, using=f"{_MATCH} OR {_SHARED}", check=_MATCH)

    conn.execute(sa.text(
        "ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public "
        "REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM fieldgovern_app"
    ))
    conn.execute(sa.text(
        "ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public "
        "REVOKE USAGE, SELECT ON SEQUENCES FROM fieldgovern_app"
    ))
    conn.execute(sa.text(
        "REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM fieldgovern_app"
    ))
    conn.execute(sa.text(
        "REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM fieldgovern_app"
    ))
