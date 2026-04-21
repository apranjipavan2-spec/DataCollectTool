#!/bin/sh
set -e

echo "=== Waiting for database and stamping alembic ==="
python /app/scripts/wait_and_stamp.py || echo "wait_and_stamp warning — continuing"

echo "=== Running Alembic migrations ==="
alembic upgrade head || echo "Alembic warning — schema patches in seed will cover gaps"

echo "=== Running seed script (applies schema patches + users) ==="
python scripts/seed_dev.py

echo "=== Starting uvicorn ==="
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
