"""Complete the restricted runtime role `fieldgovern_app` so the app can connect
as a NON-superuser and RLS is actually enforced.

Background: the app was connecting as the Postgres bootstrap user (POSTGRES_USER,
a SUPERUSER). Superusers bypass ALL row-level security — even FORCE RLS — so the
tenant_isolation policies on submissions/users/forms/etc. were dead weight in
production; only the Python .filter(tenant_id==...) calls kept clients apart.

Migration 0001 created `fieldgovern_app` but only granted DML on the 7 tables that
existed then, and nothing auto-granted on tables added by later migrations — so the
role was never actually usable and the switch was never made.

This migration makes `fieldgovern_app` a complete, safe runtime role:
  - explicitly NOSUPERUSER / NOBYPASSRLS (so RLS applies to it)
  - DML on ALL current tables + USAGE/SELECT on ALL sequences
  - ALTER DEFAULT PRIVILEGES so every future migration's tables auto-grant

To actually enforce RLS, point the app runtime at this role by setting
APP_DATABASE_URL (see backend/.env.example). Migrations/seeds keep using the
superuser DATABASE_URL. Everything is idempotent and safe to re-run.

ponytail: reuses the existing fieldgovern_app role rather than inventing a new
isolation model; the DB already had RLS, it just wasn't being enforced.
"""
import os
import sqlalchemy as sa
from alembic import op

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    # Ensure the role exists (0001 creates it; be defensive on a patched DB).
    conn.execute(sa.text("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fieldgovern_app') THEN
                CREATE ROLE fieldgovern_app LOGIN NOINHERIT;
            END IF;
        END $$;
    """))

    # Never a superuser, never bypass RLS — this is the whole point of the role.
    conn.execute(sa.text(
        "ALTER ROLE fieldgovern_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE"
    ))

    # Set the runtime password from the environment if provided, so it is not the
    # placeholder from 0001. Left unchanged when APP_DB_PASSWORD is unset.
    app_pw = os.environ.get("APP_DB_PASSWORD")
    if app_pw:
        conn.execute(sa.text("ALTER ROLE fieldgovern_app PASSWORD :pw"), {"pw": app_pw})

    # Privileges on everything that exists now.
    conn.execute(sa.text("GRANT USAGE ON SCHEMA public TO fieldgovern_app"))
    conn.execute(sa.text(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fieldgovern_app"
    ))
    conn.execute(sa.text(
        "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fieldgovern_app"
    ))

    # Auto-grant on objects future migrations create. Default privileges are keyed
    # to the role that creates the object; migrations run as the current superuser,
    # so scope the default to CURRENT_USER (PG14+).
    conn.execute(sa.text(
        "ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public "
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fieldgovern_app"
    ))
    conn.execute(sa.text(
        "ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public "
        "GRANT USAGE, SELECT ON SEQUENCES TO fieldgovern_app"
    ))


def downgrade():
    conn = op.get_bind()
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
