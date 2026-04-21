#!/bin/sh
set -e

echo "=== Waiting for database ==="
python /app/scripts/wait_and_stamp.py

echo "=== Running Alembic migrations ==="
alembic upgrade head

echo "=== Running seed script ==="
python scripts/seed_dev.py || true

echo "=== Starting uvicorn ==="
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
