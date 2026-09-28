#!/bin/sh
set -e

echo "=== Waiting for database and stamping alembic ==="
python /app/scripts/wait_and_stamp.py || echo "wait_and_stamp warning — continuing"

echo "=== Running Alembic migrations ==="
alembic upgrade head

echo "=== Running seed script (applies schema patches + users) ==="
python scripts/seed_dev.py

echo "=== Running program seed (14 programs across 7 sectors) ==="
python scripts/seed_programs.py || echo "seed_programs warning — continuing"

echo "=== Seeding billing plans ==="
python scripts/seed_plans.py || echo "seed_plans warning — continuing"

echo "=== Starting uvicorn ==="
# --proxy-headers makes uvicorn read the real client IP from nginx's X-Forwarded-For /
# X-Real-IP (see deploy/nginx.conf) instead of reporting nginx's own container IP for
# every request. forwarded-allow-ips='*' is safe here: the app container has no
# published port (see deploy/docker-compose.prod.yml) — nginx is the only thing that
# can ever reach it.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips='*'
