# FieldGovern Deployment Knowledge Base

## Overview

FieldGovern is a FastAPI + React + PostgreSQL B2B SaaS platform deployed on a Contabo VPS (EU, 4 vCPU, 8GB RAM, 75GB NVMe, IP: 178.238.227.32).
Domain: app.fieldgovern.com (SSL via Let's Encrypt / certbot)
GitHub repo: https://github.com/apranjipavan2-spec/DataCollectTool

## Infrastructure Stack

| Layer | Technology |
|-------|-----------|
| Container runtime | Docker + Docker Compose (docker-compose-plugin) |
| App image registry | GitHub Container Registry (ghcr.io) |
| CI/CD | GitHub Actions (.github/workflows/deploy-app.yml) |
| Reverse proxy | Nginx (nginx:alpine container) |
| SSL | Let's Encrypt via certbot (standalone + auto-renew cron) |
| Database | PostgreSQL 16 (postgres:16-alpine container) |
| Migrations | Alembic (runs at every startup via start.sh) |
| Seed data | backend/scripts/seed_dev.py (idempotent, fast-path if already seeded) |
| Backup | pg_dump daily cron → local 7-day retention + optional Cloudflare R2 (30 days) |
| Firewall | UFW (allow 22, 80, 443 only) |

## Deployment Flow — Step by Step

### Trigger
A push to the main branch on GitHub triggers the GitHub Actions workflow at .github/workflows/deploy-app.yml.
The workflow also has a workflow_dispatch trigger for manual deploys.

### Phase 1 — Build Docker Image (GitHub Actions, ubuntu-latest runner)
1. Checkout code
2. Login to ghcr.io using GITHUB_TOKEN
3. Extract metadata (tags: sha-<commit>, latest) using docker/metadata-action@v5
4. Set up QEMU for multi-arch emulation (linux/amd64 + linux/arm64)
5. Set up Docker Buildx
6. Build multi-arch image and push to ghcr.io/apranjipavan2-spec/datacollecttool
7. GitHub Actions cache (type=gha) is used for layer caching

### Phase 2 — Deploy to VPS (SSH via appleboy/ssh-action@v1)
Secrets required: VPS_HOST, VPS_USER, VPS_SSH_KEY, GHCR_PAT
Target directory on server: /opt/fieldgovern

Steps on server:
1. cd /opt/fieldgovern
2. docker login ghcr.io -u apranjipavan2-spec --password-stdin (using GHCR_PAT)
3. docker compose pull app (pulls latest image)
4. docker compose up -d --no-deps app (zero-downtime: old container stays up until new one healthy)
5. docker compose exec -T app sh -c "alembic upgrade head || true" (applies new migrations)

### Phase 3 — Health Check (GitHub Actions runner)
- Sleep 30 seconds (allow container to start)
- curl -f https://app.fieldgovern.com/health
- If HTTP 200: deploy passes. If not: workflow fails.

## Container Startup Sequence (inside app container)

When the app container starts, backend/start.sh runs:
1. wait_and_stamp.py — waits for PostgreSQL to be ready (retries with exponential backoff), detects DB state, stamps alembic_version if missing
2. alembic upgrade head — applies all pending migrations (0001 through 0018)
3. seed_dev.py — fast-path: if Demo Org tenant exists, exits immediately (warm restart takes <5s). If fresh DB: seeds all demo tenants, users, forms
4. uvicorn app.main:app --host 0.0.0.0 --port 8000

## Docker Compose Services

### postgres
- Image: postgres:16-alpine
- Persistent volume: postgres_data
- Health check: pg_isready (10s interval, 5 retries)
- Env: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB (from .env)

### app
- Image: ghcr.io/apranjipavan2-spec/datacollecttool:latest
- Env file: .env (DATABASE_URL, JWT_SECRET, CORS_ORIGINS, etc.)
- Depends on: postgres (healthy)
- Volume: uploads (for media files)
- Port: 8000 (internal, not exposed externally)

### nginx
- Image: nginx:alpine
- Ports: 80 (HTTP→HTTPS redirect), 443 (HTTPS)
- Volumes: nginx.conf, /etc/letsencrypt (certbot certs), certbot_webroot
- Depends on: app

## Critical DATABASE_URL Format

IMPORTANT: The DATABASE_URL must use postgresql:// prefix (NOT postgresql+psycopg2://).
Reason: wait_and_stamp.py uses psycopg2.connect() directly, which only accepts the standard prefix.
SQLAlchemy-specific prefixes (postgresql+psycopg2://) cause connection failures.

Correct format: postgresql://fieldgovern:PASSWORD@postgres:5432/fieldgovern

## Known Issues and Fixes Applied

### Password special characters in DATABASE_URL
@ and # characters in passwords break URL parsing (@ is URL delimiter, # is fragment delimiter).
Fix: Use only alphanumeric characters in the database password.

### Stale postgres volume after password change
If POSTGRES_PASSWORD changes but the postgres volume persists, the DB still uses the old password.
Fix: docker compose down -v (destroys volume) then docker compose up -d (recreates with new password).
WARNING: This destroys all data. Always backup first.

### Alembic version table missing
The original DB was created with create_all (not alembic). Alembic couldn't run migrations.
Fix: wait_and_stamp.py detects DB state, creates alembic_version table, stamps to correct revision.
Do NOT remove wait_and_stamp.py — it runs on every deployment and is load-bearing.

### CORS_ORIGINS pydantic-settings v2 issue
pydantic-settings v2 tries json.loads() on List[str] fields. Comma-separated URLs fail JSON parsing.
Fix: CORS_ORIGINS is now type str in config.py with a cors_origins property that parses it.
Do NOT change CORS_ORIGINS back to List[str] type.

### seed_dev.py slow restart
Original seed ran full user/form creation on every startup (30-60s).
Fix: Fast-path early exit if Demo Org tenant exists. Warm restarts now take <5s.

### GitHub Actions path filter not triggering
Empty commits do not trigger path-filtered workflows.
Fix: Use workflow_dispatch (manual trigger) for test deploys with no code changes.

## Server Bootstrap (first time only)

Run on fresh Ubuntu 22.04/24.04 VPS:
curl -sL https://raw.githubusercontent.com/apranjipavan2-spec/DataCollectTool/main/deploy/server-setup.sh | bash

The bootstrap script does:
1. System update and Docker installation (official Docker repo, not snap)
2. Install certbot for SSL
3. Configure UFW firewall (ports 22, 80, 443)
4. Create fieldgovern deploy user, add to docker group
5. Create /opt/fieldgovern app directory
6. Copy docker-compose.prod.yml, nginx.conf, backup-db.sh to app directory
7. Create .env template (must be manually filled in)
8. Obtain Let's Encrypt SSL certificate (certbot --standalone)
9. Set up cron: SSL renewal at 3 AM daily + restart nginx
10. Set up cron: DB backup at 2 AM daily

## GitHub Actions Secrets Required

| Secret | Value |
|--------|-------|
| VPS_HOST | Server IP address (178.238.227.32) |
| VPS_USER | SSH username (root for Contabo) |
| VPS_SSH_KEY | Full private SSH key content |
| GHCR_PAT | GitHub PAT with read:packages scope |

Set in: GitHub repo → Settings → Secrets → Actions → Environment: production

## Environment Variables on Server (.env file at /opt/fieldgovern/.env)

POSTGRES_USER=fieldgovern
POSTGRES_PASSWORD=<alphanumeric only, no @ or #>
POSTGRES_DB=fieldgovern
DATABASE_URL=postgresql://fieldgovern:PASSWORD@postgres:5432/fieldgovern
JWT_SECRET=<min 32 chars random string>
CORS_ORIGINS=https://app.fieldgovern.com,http://localhost:5173
STORAGE_BACKEND=local
APP_URL=https://app.fieldgovern.com
SMTP_HOST=<optional>
SMTP_PORT=587

## Backup System

Daily backup at 2 AM via /opt/fieldgovern/backup-db.sh:
1. pg_dump inside postgres container → pipe to gzip → save to /opt/fieldgovern/backups/
2. Optional: rclone upload to Cloudflare R2 (free up to 10GB)
3. Delete local backups older than 7 days
4. Delete R2 backups older than 30 days

To enable R2 backup: add R2_BUCKET=fieldgovern-backups to .env
To restore from backup: gunzip -c backup.sql.gz | docker compose exec -T postgres psql -U fieldgovern fieldgovern

## Hosting Provider Details

Provider: Contabo (contabo.com) — Cloud VPS 10
Specs: 4 vCPU, 8GB RAM, 75GB NVMe
Region: EU (Germany) — ~250-300ms from India (acceptable for offline-first app)
Cost: 3.96 USD/month (12-month term)
OS: Ubuntu 24.04 LTS

Alternative providers considered: Oracle Cloud Free Tier (A1.Flex, capacity issues in India region), Hetzner (CX22 Singapore, EUR 3.79/month), DigitalOcean (BLR1, 12 USD/month)

## Multi-Arch Docker Image

The image is built for both linux/amd64 and linux/arm64 using QEMU emulation in GitHub Actions.
This allows deployment on:
- Contabo/Hetzner/DigitalOcean (AMD64)
- Oracle Cloud Ampere A1 free tier (ARM64)

## SSL Certificate Renewal

Automatic via cron at 3 AM daily:
certbot renew --quiet --deploy-hook 'cd /opt/fieldgovern && docker compose restart nginx'

Manual renewal if needed:
docker compose stop nginx
certbot renew
docker compose start nginx

## Useful Operational Commands

# View app logs
docker compose -f /opt/fieldgovern/docker-compose.yml logs -f app

# Restart app
docker compose -f /opt/fieldgovern/docker-compose.yml restart app

# Force redeploy without code change
# → Go to GitHub repo → Actions → Build & Deploy App → Run workflow

# Run manual backup
/opt/fieldgovern/backup-db.sh

# Check disk usage
df -h

# Check container status
docker compose -f /opt/fieldgovern/docker-compose.yml ps
