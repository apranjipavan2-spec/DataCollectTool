#!/usr/bin/env bash
# Run the Kobo-import + partner-API test suites against a throwaway Postgres.
# Needs: Docker running, Python deps from backend/requirements.txt. No accounts or credentials.
# Usage: bash api/run_tests.sh          (Kobo + partner API suites)
#        bash api/run_tests.sh --all    (whole backend suite)
set -euo pipefail
cd "$(dirname "$0")/../backend"

NAME=fg_test_pg
PORT=55432
if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --rm --name "$NAME" -e POSTGRES_USER=fieldgovern -e POSTGRES_PASSWORD=testpw \
    -e POSTGRES_DB=fieldgovern_test -p 127.0.0.1:$PORT:5432 postgres:16-alpine >/dev/null
  for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U fieldgovern >/dev/null 2>&1 && break; sleep 2; done
fi
export TEST_DATABASE_URL="postgresql://fieldgovern:testpw@localhost:$PORT/fieldgovern_test"

if [ "${1:-}" = "--all" ]; then
  python -m pytest tests -q -p no:cacheprovider
else
  python -m pytest tests/test_kobo_migration.py tests/test_partner_api.py tests/test_dashboard_shares.py tests/test_org_feeds.py -q -p no:cacheprovider
fi
echo "Stop the test DB with: docker stop $NAME"
