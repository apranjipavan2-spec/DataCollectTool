#!/bin/sh
set -e

echo "=== Waiting for database ==="
python - <<'PYEOF'
import os, time, psycopg2

url = os.environ.get("DATABASE_URL", "")
for i in range(30):
    try:
        conn = psycopg2.connect(url)
        conn.close()
        print(f"Database ready after {i+1} attempt(s).")
        break
    except Exception as e:
        print(f"Attempt {i+1}/30: {e}")
        time.sleep(2)
else:
    raise SystemExit("Database not reachable after 60s — aborting.")
PYEOF

echo "=== Checking alembic state ==="
python - <<'PYEOF'
import os, psycopg2, subprocess, sys

def col_exists(cur, table, col):
    cur.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_name=%s AND column_name=%s",
        (table, col)
    )
    return bool(cur.fetchone())

def table_exists(cur, table):
    cur.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_name=%s",
        (table,)
    )
    return bool(cur.fetchone())

conn = psycopg2.connect(os.environ["DATABASE_URL"])
conn.autocommit = True
cur = conn.cursor()

# Check if alembic_version table exists and has a revision
has_alembic = table_exists(cur, 'alembic_version')
current_rev = None
if has_alembic:
    cur.execute("SELECT version_num FROM alembic_version LIMIT 1")
    row = cur.fetchone()
    current_rev = row[0] if row else None

print(f"alembic_version exists: {has_alembic}, current rev: {current_rev}")

# If alembic_version is missing or empty but the DB has existing tables,
# detect which revision the DB is actually at and stamp it.
if (not has_alembic or not current_rev) and table_exists(cur, 'tenants'):
    print("DB has tables but no alembic tracking — detecting revision to stamp...")

    if not table_exists(cur, 'schedules'):
        stamp = '0007'
    elif not table_exists(cur, 'form_versions'):
        stamp = '0008'
    elif not table_exists(cur, 'push_subscriptions'):
        stamp = '0010'
    elif not table_exists(cur, 'api_keys'):
        stamp = '0011'
    elif not col_exists(cur, 'tenants', 'app_name'):
        stamp = '0012'
    elif not col_exists(cur, 'users', 'email'):
        stamp = '0013'
    elif not table_exists(cur, 'webhooks'):
        stamp = '0014'
    elif not col_exists(cur, 'tenants', 'allow_enumerator_edit'):
        stamp = '0015'
    elif not table_exists(cur, 'programs'):
        stamp = '0016'
    elif not col_exists(cur, 'submissions', 'program_id'):
        stamp = '0017'
    else:
        stamp = '0018'

    print(f"Stamping alembic_version to {stamp}")
    if not has_alembic:
        cur.execute("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL, CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))")
    cur.execute("DELETE FROM alembic_version")
    cur.execute("INSERT INTO alembic_version (version_num) VALUES (%s)", (stamp,))
    print(f"Stamped to {stamp}")

cur.close()
conn.close()
PYEOF

echo "=== Running Alembic migrations ==="
alembic upgrade head

echo "=== Running seed script ==="
python scripts/seed_dev.py || true

echo "=== Starting uvicorn ==="
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
