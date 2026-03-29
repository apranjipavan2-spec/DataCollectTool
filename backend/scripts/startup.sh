#!/bin/sh
set -e

echo "=== FieldPulse Startup ==="
echo "DATABASE_URL prefix: $(echo $DATABASE_URL | cut -c1-30)..."
echo "Python: $(python --version)"

cd /app

echo "=== Running migrations ==="
alembic upgrade head
echo "=== Migrations complete ==="

echo "=== Seeding dev data ==="
python scripts/seed_dev.py || echo "Seed skipped (may already exist)"

echo "=== Starting server ==="
exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
