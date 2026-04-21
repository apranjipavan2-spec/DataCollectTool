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

echo "=== Running Alembic migrations ==="
alembic upgrade head

echo "=== Running seed script ==="
python scripts/seed_dev.py || true

echo "=== Starting uvicorn ==="
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
