"""Enforce phone + email uniqueness for active users.

Auth lookups in `auth.py` (login, Google, password reset) match users by
phone or email without a tenant filter — that is the correct design when
phone/email is a global identity, but it relies on those values being
unique. The application layer already checks for duplicates at register
time; this migration adds a DB-level guarantee.

Strategy — partial unique indexes:
- Active users (`is_active = TRUE`) get unique phone and unique email.
- Inactive rows are exempt so historical/disabled accounts that share a
  phone with a new active account don't break.
- Registration placeholders (`phone LIKE 'reg_%'`) are also exempt — those
  are random UUIDs assigned when the user registered without a phone.

If a current DB has duplicate active phones/emails, the index creation
fails loudly. A short DO block first surfaces any conflicts so the
operator can deduplicate before the constraint lands.
"""
import sqlalchemy as sa
from alembic import op

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    # Surface duplicates up-front so the failure is informative, not opaque.
    conn.execute(sa.text("""
        DO $$
        DECLARE
            dup_phone   text;
            dup_email   text;
        BEGIN
            SELECT phone INTO dup_phone
            FROM   users
            WHERE  is_active = TRUE
              AND  phone NOT LIKE 'reg_%'
            GROUP  BY phone
            HAVING COUNT(*) > 1
            LIMIT 1;
            IF dup_phone IS NOT NULL THEN
                RAISE EXCEPTION
                    'Duplicate active phone % — resolve before running 0042.', dup_phone;
            END IF;

            SELECT lower(email) INTO dup_email
            FROM   users
            WHERE  is_active = TRUE
              AND  email IS NOT NULL
              AND  email <> ''
            GROUP  BY lower(email)
            HAVING COUNT(*) > 1
            LIMIT 1;
            IF dup_email IS NOT NULL THEN
                RAISE EXCEPTION
                    'Duplicate active email % — resolve before running 0042.', dup_email;
            END IF;
        END $$;
    """))

    conn.execute(sa.text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_users_active_phone
        ON users (phone)
        WHERE is_active = TRUE AND phone NOT LIKE 'reg_%'
    """))

    conn.execute(sa.text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_users_active_email
        ON users (lower(email))
        WHERE is_active = TRUE AND email IS NOT NULL AND email <> ''
    """))


def downgrade():
    conn = op.get_bind()
    conn.execute(sa.text("DROP INDEX IF EXISTS uq_users_active_email"))
    conn.execute(sa.text("DROP INDEX IF EXISTS uq_users_active_phone"))
