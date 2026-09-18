#!/bin/bash
# Daily PostgreSQL backup
# - Dumps DB, compresses, keeps 7 days locally
# - Uploads to Cloudflare R2 (free ≤10GB) via rclone if configured
#
# Setup rclone for R2 (one-time):
#   apt install rclone
#   rclone config  →  name: r2  type: s3  provider: Cloudflare
#   Set R2_BUCKET below and uncomment the upload lines
set -euo pipefail

APP_DIR="/opt/fieldgovern"
BACKUP_DIR="/opt/fieldgovern/backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
FILENAME="fieldgovern_${TIMESTAMP}.sql.gz"

# Cloudflare R2 config — set bucket name, leave blank to skip offsite upload
R2_BUCKET="${R2_BUCKET:-}"   # e.g. "fieldgovern-backups"
R2_KEEP_DAYS=30              # keep 30 days in R2 (free tier fits easily)

mkdir -p "$BACKUP_DIR"

# ── 1. Dump & compress ────────────────────────────────────────────────────────
docker compose -f "$APP_DIR/docker-compose.yml" exec -T postgres \
  pg_dump -U fieldgovern fieldgovern | gzip > "$BACKUP_DIR/$FILENAME"

SIZE=$(du -sh "$BACKUP_DIR/$FILENAME" | cut -f1)
echo "[$(date)] Backup created: $FILENAME ($SIZE)"

# ── 2. Upload to Cloudflare R2 (if configured) ───────────────────────────────
if [ -n "$R2_BUCKET" ] && command -v rclone &>/dev/null; then
  rclone copy "$BACKUP_DIR/$FILENAME" "r2:$R2_BUCKET/db/" --quiet
  echo "[$(date)] Uploaded to R2: r2:$R2_BUCKET/db/$FILENAME"

  # Delete R2 objects older than 30 days
  rclone delete "r2:$R2_BUCKET/db/" \
    --min-age "${R2_KEEP_DAYS}d" --quiet
  echo "[$(date)] R2 cleanup done (kept last ${R2_KEEP_DAYS} days)"
else
  echo "[$(date)] R2 not configured — local backup only"
fi

# ── 3. Clean local backups older than 7 days ─────────────────────────────────
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete
echo "[$(date)] Local cleanup done. Remaining: $(ls "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l) files"
