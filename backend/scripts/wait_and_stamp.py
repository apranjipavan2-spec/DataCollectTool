"""
Wait for DB to be ready, then auto-stamp alembic_version if missing.
Run before `alembic upgrade head` to handle DBs created without alembic tracking.
"""
import os
import sys
import time
import psycopg2

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if  DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)


def wait_for_db():
    for i in range(30):
        try:
            conn = psycopg2.connect(DATABASE_URL)
            conn.close()
            print(f"Database ready after {i + 1} attempt(s).")
            return
        except Exception as e:
            print(f"Attempt {i + 1}/30: {e}")
            time.sleep(2)
    raise SystemExit("Database not reachable after 60s — aborting.")


def col_exists(cur, table, col):
    cur.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_name=%s AND column_name=%s",
        (table, col),
    )
    return bool(cur.fetchone())


def table_exists(cur, table):
    cur.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_name=%s",
        (table,),
    )
    return bool(cur.fetchone())


def detect_and_stamp():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()

    has_alembic = table_exists(cur, "alembic_version")
    current_rev = None
    if has_alembic:
        cur.execute("SELECT version_num FROM alembic_version LIMIT 1")
        row = cur.fetchone()
        current_rev = row[0] if row else None

    print(f"alembic_version exists: {has_alembic}, current rev: {current_rev}")

    if (not has_alembic or not current_rev) and table_exists(cur, "tenants"):
        print("DB has tables but no alembic tracking — detecting revision to stamp...")

        if not table_exists(cur, "schedules"):
            stamp = "0007"
        elif not table_exists(cur, "form_versions"):
            stamp = "0008"
        elif not table_exists(cur, "push_subscriptions"):
            stamp = "0010"
        elif not table_exists(cur, "api_keys"):
            stamp = "0011"
        elif not col_exists(cur, "tenants", "app_name"):
            stamp = "0012"
        elif not col_exists(cur, "users", "email"):
            stamp = "0013"
        elif not table_exists(cur, "webhooks"):
            stamp = "0014"
        elif not col_exists(cur, "tenants", "allow_enumerator_edit"):
            stamp = "0015"
        elif not table_exists(cur, "programs"):
            stamp = "0016"
        elif not col_exists(cur, "submissions", "program_id"):
            stamp = "0017"
        elif not col_exists(cur, "tenants", "notification_config"):
            stamp = "0018"
        elif not col_exists(cur, "submissions", "has_violations"):
            stamp = "0019"
        elif not table_exists(cur, "respondent_roster"):
            stamp = "0020"
        elif not col_exists(cur, "tenants", "ai_config"):
            stamp = "0021"
        elif not col_exists(cur, "submissions", "roster_id"):
            stamp = "0022"
        elif not table_exists(cur, "locations"):
            stamp = "0023"
        elif not col_exists(cur, "submissions", "household_id"):
            stamp = "0024"
        elif not col_exists(cur, "submissions", "backcheck_completed"):
            stamp = "0025"
        elif not table_exists(cur, "system_settings"):
            stamp = "0026"
        elif not col_exists(cur, "program_locations", "program_id"):
            stamp = "0027"
        elif not table_exists(cur, "user_tool_projects"):
            stamp = "0028"
        elif not col_exists(cur, "forms", "allow_enumerator_edit"):
            stamp = "0030"
        else:
            stamp = "0031"

        print(f"Stamping alembic_version to {stamp}")
        if not has_alembic:
            cur.execute(
                "CREATE TABLE alembic_version ("
                "version_num VARCHAR(32) NOT NULL, "
                "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
            )
        cur.execute("DELETE FROM alembic_version")
        cur.execute("INSERT INTO alembic_version (version_num) VALUES (%s)", (stamp,))
        print(f"Stamped to {stamp} — alembic upgrade head will apply remaining migrations.")
    else:
        print(f"Alembic tracking OK at rev: {current_rev}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    wait_for_db()
    detect_and_stamp()
