#!/bin/bash
# Daily PostgreSQL backup — runs via cron, keeps 7 days locally
set -euo pipefail

APP_DIR="/opt/fieldgovern"
BACKUP_DIR="/opt/fieldgovern/backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
FILENAME="fieldgovern_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

# Dump inside the postgres container and compress
docker compose -f "$APP_DIR/docker-compose.yml" exec -T postgres \
  pg_dump -U fieldgovern fieldgovern | gzip > "$BACKUP_DIR/$FILENAME"

echo "[$(date)] Backup created: $FILENAME ($(du -sh "$BACKUP_DIR/$FILENAME" | cut -f1))"

# Delete backups older than 7 days
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete
echo "[$(date)] Old backups cleaned. Current count: $(ls "$BACKUP_DIR" | wc -l)"
