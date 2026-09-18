# FieldGovern Deployment Knowledge Base

## Overview

FieldGovern is a FastAPI + React + PostgreSQL B2B SaaS platform deployed on a Contabo VPS.
- **Domain:** app.fieldgovern.com (SSL via Let's Encrypt / certbot)
- **Server:** Contabo Cloud VPS 10 — 4 vCPU, 8GB RAM, 75GB NVMe, EU region, ~$3.96/month
- **GitHub repo:** https://github.com/apranjipavan2-spec/DataCollectTool
- **App directory on VPS:** `/opt/fieldgovern/`

---

## Infrastructure Stack

| Layer | Technology |
|-------|-----------|
| Container runtime | Docker + Docker Compose |
| App image registry | GitHub Container Registry (ghcr.io) |
| CI/CD | GitHub Actions — `.github/workflows/deploy-app.yml` |
| Reverse proxy | Nginx (`nginx:alpine` container) |
| SSL | Let's Encrypt via certbot (auto-renew cron) |
| Database | PostgreSQL 16 (`postgres:16-alpine` container) |
| Migrations | Alembic (runs at every deploy) |
| Backup | `pg_dump` daily cron → local 7-day + optional Cloudflare R2 (30-day) |
| Firewall | UFW — ports 22, 80, 443 only |

---

## Services Running on VPS

### Core Services (managed by docker-compose.yml at /opt/fieldgovern/)

| Container | Image / Build | Port | Purpose |
|-----------|--------------|------|---------|
| `fieldgovern-postgres-1` | postgres:16-alpine | internal | Database |
| `fieldgovern-app-1` | ghcr.io/apranjipavan2-spec/datacollecttool:latest | 8000 (internal) | FastAPI + React SPA |
| `fieldgovern-nginx-1` | nginx:alpine | 80, 443 | Reverse proxy + SSL |

### Tool Services (managed by `docker run` in deploy script)

| Container | Image (built on VPS) | Port | URL |
|-----------|---------------------|------|-----|
| `analyzer` | fieldgovern-analyzer:latest | 8001 (internal) | app.fieldgovern.com/analyzer/ |
| `cleaner` | fieldgovern-cleaner:latest | 8002 (internal) | app.fieldgovern.com/cleaner/ |

Tool containers are started with `docker run --network fieldgovern_default` so they share the same Docker network as nginx and can be proxied by service name.

---

## Deployment Flow — Step by Step

### Trigger
Push to `main` branch on paths: `backend/**`, `frontend/**`, `Dockerfile`, `deploy/**`, `tools/**`, `.github/workflows/deploy-app.yml`.
Also has `workflow_dispatch` for manual deploys.

### Phase 1 — Build Main App Docker Image (GitHub Actions runner)
1. Checkout code
2. Login to ghcr.io using GITHUB_TOKEN
3. Extract metadata (tags: `sha-<commit>`, `latest`)
4. Set up QEMU + Docker Buildx for multi-arch (linux/amd64 + linux/arm64)
5. Build and push to `ghcr.io/apranjipavan2-spec/datacollecttool`
6. GitHub Actions GHA cache used for layer caching (speeds up unchanged layers)

### Phase 2 — Deploy to VPS (SSH via appleboy/ssh-action)

Required secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `GHCR_PAT`

**Script steps (run from `/opt/fieldgovern/`):**

```bash
# 1. Pull and restart main app
docker login ghcr.io -u apranjipavan2-spec --password-stdin
docker compose pull app
docker compose up -d --no-deps app

# 2. Run DB migrations
docker compose exec -T app sh -c "alembic upgrade head 2>&1 || true"

# 3. Build tool images on VPS (from files synced by SCP step)
docker build -t fieldgovern-analyzer:latest /opt/fieldgovern/tools/tableforge
docker build -t fieldgovern-cleaner:latest /opt/fieldgovern/tools/datacleaner

# 4. Find nginx's network, start tools on the same network
NGINX_ID=$(docker ps -q -f "name=nginx" | head -1)
NGINX_NET=<detected from docker inspect>
docker ps -aq -f "name=analyzer" | xargs docker rm -f
docker ps -aq -f "name=cleaner"  | xargs docker rm -f
docker run -d --name analyzer --network $NGINX_NET --restart unless-stopped ...
docker run -d --name cleaner  --network $NGINX_NET --restart unless-stopped ...

# 5. Update nginx config and RESTART nginx (not just reload — see Known Issues)
curl -fsSL "https://raw.githubusercontent.com/.../nginx.conf" -o /opt/fieldgovern/nginx.conf
docker restart $NGINX_ID
```

### Phase 3 — Health Check
- Sleep 30 seconds
- `curl -f https://app.fieldgovern.com/health` — must return HTTP 200

---

## Analyzer and Cleaner Tools

### What They Are

| Tool | Source | Deployed URL | Purpose |
|------|--------|-------------|---------|
| **TableForge** (Analyzer) | `tools/tableforge/` | `/analyzer/` | Data tabulation, cross-tabs, statistics, Excel export |
| **DataCleaner** | `tools/datacleaner/` | `/cleaner/` | Data cleaning, deduplication, column mapping |

### Architecture

**TableForge:** Multi-stage Docker build
1. `node:20-slim` stage — builds React/Vite frontend with `VITE_BASE_PATH=/analyzer/`
2. `python:3.11-slim` stage — runs FastAPI backend on port 8001, serves the built frontend as static files

**DataCleaner:** Single-stage Docker build
- `python:3.11-slim` — runs Flask app on port 8002 with Jinja2 templates

### Nginx Routing

```nginx
# Redirect /analyzer → /analyzer/ (no trailing slash)
location = /analyzer { return 301 /analyzer/; }
location = /cleaner  { return 301 /cleaner/; }

# Proxy to tool containers (strip /analyzer/ prefix)
location /analyzer/ {
    proxy_pass http://analyzer:8001/;
    proxy_read_timeout 300s;
    client_max_body_size 200M;
}
location /cleaner/ {
    proxy_pass http://cleaner:8002/;
    proxy_read_timeout 300s;
    client_max_body_size 200M;
}
```

### FieldGovern Integration

- **Export endpoint:** `GET /api/v1/fg/programs/{program_id}/export.xlsx` (Bearer JWT, supervisor+)
- **Analyzer import:** `POST /analyzer/api/import-from-fg` — fetches the export and loads it as a dataset
- **Cleaner import:** `POST /cleaner/api/load-from-fg` — same flow for DataCleaner
- **Frontend buttons:** "Open in Analyzer" and "Open in Cleaner" on ProgramsPage and FieldGovern.tsx — role-gated (supervisor/admin), pass `fg_url`, `program_id`, `token` as URL params

---

## Known Issues and Fixes

### Stale Nginx Bind-Mount Inode (Critical — solved April 2026)

**Symptom:** Nginx config file is updated on the host (`/opt/fieldgovern/nginx.conf`), `nginx -t` passes, `nginx -s reload` runs — but the container still serves the OLD config. New location blocks (`/analyzer/`, `/cleaner/`) are invisible inside the container.

**Root cause:** Docker file bind-mounts lock to the file's inode at container start time. If the host file is later replaced (new inode created at the same path — e.g., by `curl -o`, `cp`, or `mv`), the bind-mount still reads the ORIGINAL inode. `nginx -s reload` re-reads from the container's view of the file, which is still the old inode.

**Fix:** `docker restart <nginx_container_id>` — this stops and restarts the container, re-establishing the bind-mount against the current file at the path (current inode). The new config is applied on start.

**Rule:** Whenever the nginx.conf changes, always `docker restart` the nginx container — never rely on `nginx -s reload` alone after a file update outside the container.

---

### Docker Compose Project / Network Isolation

**Symptom:** Running `docker compose -f deploy/docker-compose.prod.yml up -d analyzer cleaner` starts the tools in a different Docker project (named from the compose file's directory, e.g., `deploy`), creating a separate `deploy_default` network. Nginx (on `fieldgovern_default`) cannot resolve `http://analyzer:8001`.

**Fix:** Start tools with `docker run --network fieldgovern_default` (or nginx's detected network). This bypasses Docker Compose project isolation entirely.

**Rule:** Never use a separate compose invocation with a different project directory for tool containers. Use `docker run` directly with explicit `--network`.

---

### Workflow Not Triggering on Workflow File Changes

**Symptom:** Changes to `.github/workflows/deploy-app.yml` don't trigger the workflow because the file path wasn't in the `paths:` trigger list.

**Fix:** Added `.github/workflows/deploy-app.yml` to the `paths:` trigger list. Note: the first commit that adds a path to triggers is evaluated against the OLD workflow — it won't self-trigger. Subsequent changes to that file will trigger correctly.

---

### Idempotent Alembic Migrations

**Symptom:** Deploy fails with `DuplicateTable` or `DuplicateColumn` if a migration runs against a DB that already has those objects (e.g., after a failed partial migration or manual schema edit).

**Fix:** Wrap all DDL operations in existence checks:
```python
def _col_exists(conn, table, col):
    return conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name=:c"
    ), {"t": table, "c": col}).fetchone() is not None
```

---

### Nginx Config Validates But Proxy Fails to Start

**Symptom:** `nginx -t` passes but `/analyzer/` returns 502 or fails to proxy.

**Cause:** `nginx -t` only validates syntax — it does not test whether upstream hosts (`analyzer`, `cleaner`) are resolvable. Resolution happens when nginx worker processes start. If the tool containers aren't running or aren't on the same Docker network, resolution fails silently and nginx returns 502.

**Fix:** Always start tool containers BEFORE restarting nginx. The deploy script follows this order intentionally.

---

## Container Startup (app container)

When the app container starts, `backend/start.sh` runs:
1. `wait_and_stamp.py` — waits for PostgreSQL (retries with backoff), stamps `alembic_version` if missing
2. `alembic upgrade head` — applies pending migrations
3. `seed_dev.py` — fast-path exit if Demo Org exists; otherwise seeds demo data
4. `uvicorn app.main:app --host 0.0.0.0 --port 8000`

**Do NOT remove `wait_and_stamp.py`** — it is load-bearing for DB readiness on every deploy.

---

## Critical Configuration Notes

### DATABASE_URL Format
Must use `postgresql://` prefix (NOT `postgresql+psycopg2://`).
`wait_and_stamp.py` uses `psycopg2.connect()` directly which only accepts the standard prefix.

```
DATABASE_URL=postgresql://fieldgovern:PASSWORD@postgres:5432/fieldgovern
```

### Password Characters
Use only alphanumeric characters in `POSTGRES_PASSWORD`. The `@` and `#` characters break URL parsing.

### CORS_ORIGINS
Type must be `str` in `config.py` (not `List[str]`). pydantic-settings v2 tries `json.loads()` on list fields — comma-separated URLs cause parse failures.

---

## GitHub Actions Secrets

| Secret | Value |
|--------|-------|
| `VPS_HOST` | Server IP (178.238.227.32) |
| `VPS_USER` | SSH username (`root` for Contabo) |
| `VPS_SSH_KEY` | Full private SSH key content |
| `GHCR_PAT` | GitHub PAT with `read:packages` scope |

Set in: GitHub repo → Settings → Secrets → Actions → Environment: **production**

---

## Environment Variables (`.env` at `/opt/fieldgovern/.env`)

```env
POSTGRES_USER=fieldgovern
POSTGRES_PASSWORD=<alphanumeric only>
POSTGRES_DB=fieldgovern
DATABASE_URL=postgresql://fieldgovern:PASSWORD@postgres:5432/fieldgovern
JWT_SECRET=<min 32 chars random>
CORS_ORIGINS=https://app.fieldgovern.com,http://localhost:5173
STORAGE_BACKEND=local
APP_URL=https://app.fieldgovern.com
```

---

## Backup System

Daily cron at 2 AM via `/opt/fieldgovern/backup-db.sh`:
1. `pg_dump` inside postgres container → gzip → `/opt/fieldgovern/backups/`
2. Optional: `rclone` upload to Cloudflare R2 (free up to 10GB)
3. Delete local backups older than 7 days / R2 backups older than 30 days

To enable R2: add `R2_BUCKET=fieldgovern-backups` to `.env`

**Restore:**
```bash
gunzip -c backup.sql.gz | docker compose exec -T postgres psql -U fieldgovern fieldgovern
```

---

## Useful Operational Commands

```bash
# View logs
docker compose logs -f app
docker logs -f analyzer
docker logs -f cleaner

# Restart services
docker compose restart app
docker restart fieldgovern-nginx-1   # use restart, not reload, when config changed

# Check all containers
docker ps

# Restart analyzer/cleaner after a code change
docker build -t fieldgovern-analyzer:latest /opt/fieldgovern/tools/tableforge
docker rm -f analyzer
docker run -d --name analyzer --network fieldgovern_default --restart unless-stopped \
  -v fg_tableforge_data:/app/projects \
  -v fg_tableforge_exports:/app/exports \
  fieldgovern-analyzer:latest

# Force redeploy without code change
# GitHub repo → Actions → Build & Deploy App → Run workflow

# Run manual backup
/opt/fieldgovern/backup-db.sh

# Check disk
df -h
```

---

## SSL Certificate Renewal

Auto-renews via cron at 3 AM daily:
```bash
certbot renew --quiet --deploy-hook 'docker restart fieldgovern-nginx-1'
```

Manual renewal:
```bash
docker stop fieldgovern-nginx-1
certbot renew
docker start fieldgovern-nginx-1
```

---

## Server Bootstrap (first time only)

```bash
curl -sL https://raw.githubusercontent.com/apranjipavan2-spec/DataCollectTool/main/deploy/server-setup.sh | bash
```

Then manually fill in `/opt/fieldgovern/.env` and run:
```bash
cd /opt/fieldgovern
docker compose pull
docker compose up -d
```
