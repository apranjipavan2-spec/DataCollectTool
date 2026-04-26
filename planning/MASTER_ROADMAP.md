# FieldGovern — Master Roadmap
<!-- Single source of truth. Links all other planning files. -->
<!-- Last updated: 2026-04-26 -->

---

## Linked Planning Files

| File | Scope |
|------|-------|
| [`ROADMAP.md`](ROADMAP.md) | Core platform feature backlog (priority queue, bundle definitions) |
| [`ANALYTICS_SUITE_ROADMAP.md`](ANALYTICS_SUITE_ROADMAP.md) | Architecture vision for the full analytics pipeline |
| [`MIGRATION_SPEC.md`](MIGRATION_SPEC.md) | XLSForm / Kobo / ODK / SurveyCTO migration spec |
| [`PENDING_MANUAL.md`](PENDING_MANUAL.md) | Items blocked on external credentials / accounts |
| [`../tasks/todo.md`](../tasks/todo.md) | Sprint board (active tasks, completed this sprint) |
| [`../tasks/lessons.md`](../tasks/lessons.md) | Mistake patterns + prevention rules |

---

## Initiative Index

| # | Initiative | Status | Priority |
|---|-----------|--------|----------|
| A | [Analyzer + Cleaner Tool Integration](#initiative-a-analyzer--cleaner-tool-integration) | 🔵 Ready to build | **Highest** |
| B | [Core Platform Features](#initiative-b-core-platform-features) | 📋 Backlog | High |
| C | [AI & Automation](#initiative-c-ai--automation) | 📋 Backlog | Medium |
| D | [Compliance & Security](#initiative-d-compliance--security) | 📋 Backlog | Medium |

---

---

# Initiative A: Analyzer + Cleaner Tool Integration

**Goal:** Run `analyzer.fieldgovern.com` (TableForge) and `cleaner.fieldgovern.com` (DataCleaner) as live subdomains. Both tools launch pre-loaded with a program's submission data directly from FieldGovern. No manual CSV export. No duplicate data stores.

**Architecture:**
```
FieldGovern app (app.fieldgovern.com)
  │
  ├── "Open in Analyzer" button ──→ analyzer.fieldgovern.com?program_id=XXX&token=JWT
  │                                      │
  │                                      └── calls GET app.fieldgovern.com/api/v1/programs/XXX/export.xlsx
  │                                              (Bearer JWT) → returns submissions as Excel
  │
  └── "Open in Cleaner" button  ──→ cleaner.fieldgovern.com?program_id=XXX&token=JWT
                                         │
                                         └── same export endpoint, loads into DataCleaner
```

**Two new subdomains, two new Docker services:**
- `analyzer.fieldgovern.com` → TableForge (FastAPI, port 8001) — cross-tabs, statistical tables, charts, custom metrics
- `cleaner.fieldgovern.com` → DataCleaner (Flask, port 8002) — interactive cell editing, type correction, undo, regex fixes, AI corrections

---

## Phase A-0: Move Tools into Repository

**Goal:** Both tool codebases live inside the DataCollectTool repo under `tools/`.

### Tasks

- [ ] **A-0.1** Copy `C:\DCT\tableforge\` → `C:\Life\DataCollectTool\tools\tableforge\`
  - Copy entire directory (backend, frontend, static, library, start files)
  - Do NOT copy: `cache/`, `exports/`, `logs/`, `parquet_cache/`, `projects/`, `__pycache__/`, `.venv/`
  - Verify: `tools/tableforge/backend/main.py` exists

- [ ] **A-0.2** Copy `C:\Users\apran\Downloads\DataEntry\data_cleaning_tools\` → `C:\Life\DataCollectTool\tools\datacleaner\`
  - Copy: `data_cleaner.py`, `templates/`
  - Do NOT copy: `working_copies/`, `__pycache__/`, `recovered_mapping.json`
  - Verify: `tools/datacleaner/data_cleaner.py` exists

- [ ] **A-0.3** Add `.gitignore` entries under each tool:
  - `tools/tableforge/`: `cache/`, `exports/`, `logs/`, `parquet_cache/`, `projects/`, `__pycache__/`, `*.db`
  - `tools/datacleaner/`: `working_copies/`, `__pycache__/`, `*.pkl`, `*.db`

**Effort:** ~30 min | **Verify:** Both dirs exist with source files, no large binary dirs copied

---

## Phase A-1: FieldGovern — Export Endpoint

**Goal:** Add ONE new API endpoint that both tools will call to pull submission data.

### Tasks

- [ ] **A-1.1** Add `GET /api/v1/programs/{program_id}/export.xlsx` to `backend/app/api/routes/field_govern.py`
  - Auth: `require_supervisor` (existing dep)
  - Fetches all submissions for the program across all its questionnaires
  - Flattens `data_json` fields using existing `_flatten()` logic from `export.py`
  - Returns `StreamingResponse` with `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - Filename: `{program_name}_{date}.xlsx`
  - Columns: `serial_no`, `enumerator_name`, `form_title`, `status`, `received_at`, `household_id`, all `data_json` fields flattened

- [ ] **A-1.2** Test locally: `curl -H "Authorization: Bearer JWT" http://localhost:8000/api/v1/programs/PROG_ID/export.xlsx -o test.xlsx`

**Effort:** ~2 hours | **Files:** `backend/app/api/routes/field_govern.py`
**Verify:** Excel file downloads with correct columns and data for a test program

---

## Phase A-2: Tool Import Endpoints

**Goal:** Each tool gains one endpoint that accepts FieldGovern credentials, fetches the export, and loads it as the active dataset.

### Tasks

- [ ] **A-2.1** Add `POST /api/import-from-fg` to `tools/tableforge/backend/main.py`
  ```
  Body: { fg_base_url: str, program_id: str, token: str }
  → httpx.get(f"{fg_base_url}/api/v1/programs/{program_id}/export.xlsx", headers={"Authorization": f"Bearer {token}"})
  → save bytes to temp file
  → call existing upload logic (same as POST /api/upload) with that temp file
  → return { dataset_id, program_name, row_count }
  ```
  - On tool load: if URL params `?fg_url=&program_id=&token=` are present, frontend auto-calls this endpoint
  - Add `httpx` to TableForge requirements if not already present

- [ ] **A-2.2** Add `POST /api/load-from-fg` to `tools/datacleaner/data_cleaner.py`
  ```
  Body: { fg_base_url: str, program_id: str, token: str }
  → requests.get(export URL, headers=Bearer token)
  → save to COPIES_DIR as working copy
  → call existing load logic (same as /api/upload)
  → return { success: true, filename, row_count }
  ```
  - On page load: Flask checks `request.args` for `fg_url`, `program_id`, `token` — if present, auto-calls load endpoint
  - Add `requests` to requirements if not already present

**Effort:** ~3 hours | **Files:** `tools/tableforge/backend/main.py`, `tools/datacleaner/data_cleaner.py`
**Verify:** Both tools load FieldGovern data when given valid credentials

---

## Phase A-3: Frontend — Launch Buttons

**Goal:** Supervisors and org_admins can launch either tool pre-loaded with any program's data via one click.

### Tasks

- [ ] **A-3.1** Add "Open in Analyzer" and "Open in Cleaner" buttons to `frontend/src/programs/ProgramsPage.tsx`
  - Place in the program card action row (alongside existing "Field Govern" button)
  - On click: `window.open('https://analyzer.fieldgovern.com?fg_url=https://app.fieldgovern.com&program_id={id}&token={JWT}')`
  - Token: `getStoredUser()` → read JWT from localStorage key used by `api.ts`
  - Role-guard: only visible to `supervisor`, `org_admin`, `master_admin`

- [ ] **A-3.2** Also add the same two buttons to `frontend/src/programs/FieldGovern.tsx` (the /programs/:id/govern page)
  - Same logic, program_id already in scope

- [ ] **A-3.3** Export the JWT from `api.ts` — add helper `getToken(): string | null` if not already exported

**Effort:** ~2 hours | **Files:** `ProgramsPage.tsx`, `FieldGovern.tsx`, `lib/api.ts`
**Verify:** Buttons visible, clicking opens correct URL in new tab

---

## Phase A-4: Dockerfiles for Tools

**Goal:** Each tool has a Dockerfile that builds and runs in production.

### Tasks

- [ ] **A-4.1** Create `tools/tableforge/Dockerfile`
  ```dockerfile
  FROM node:20-slim AS frontend-builder
  WORKDIR /app/frontend
  COPY frontend/package*.json ./
  RUN npm ci
  COPY frontend ./
  RUN npm run build

  FROM python:3.11-slim
  WORKDIR /app
  RUN apt-get update && apt-get install -y --no-install-recommends build-essential gcc && rm -rf /var/lib/apt/lists/*
  COPY backend/requirements.txt ./
  RUN pip install --no-cache-dir -r requirements.txt
  COPY backend ./
  COPY --from=frontend-builder /app/frontend/dist ./static
  RUN mkdir -p cache exports logs parquet_cache projects metrics library
  ENV PYTHONUNBUFFERED=1
  EXPOSE 8001
  CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
  ```
  - Check if TableForge frontend has a `package.json` + `npm run build` — if it serves static files differently, adjust accordingly

- [ ] **A-4.2** Create `tools/datacleaner/Dockerfile`
  ```dockerfile
  FROM python:3.11-slim
  WORKDIR /app
  RUN apt-get update && apt-get install -y --no-install-recommends build-essential gcc && rm -rf /var/lib/apt/lists/*
  COPY requirements.txt ./
  RUN pip install --no-cache-dir -r requirements.txt
  COPY . .
  RUN mkdir -p working_copies
  ENV PYTHONUNBUFFERED=1
  EXPOSE 8002
  CMD ["python", "data_cleaner.py"]
  ```
  - Confirm data_cleaner.py port — currently uses 5050 locally, change to 8002 for Docker via env var `PORT`
  - Add `PORT = int(os.environ.get('PORT', 5050))` to data_cleaner.py; pass to `app.run(port=PORT, host='0.0.0.0')`

- [ ] **A-4.3** Create `tools/datacleaner/requirements.txt` (currently no separate requirements file)
  - Extract: `flask`, `pandas`, `numpy`, `openpyxl`, `python-dotenv`, `requests`, `xlrd`

**Effort:** ~2 hours | **Verify:** Both Dockerfiles build locally without errors

---

## Phase A-5: Docker Compose + nginx

**Goal:** Both tools run as services in the production stack, accessible via subdomains.

### Tasks

- [ ] **A-5.1** Update `deploy/docker-compose.prod.yml` — add two services:
  ```yaml
  analyzer:
    build:
      context: ../tools/tableforge
      dockerfile: Dockerfile
    restart: always
    volumes:
      - tableforge_data:/app/projects
      - tableforge_exports:/app/exports
    expose:
      - "8001"

  cleaner:
    build:
      context: ../tools/datacleaner
      dockerfile: Dockerfile
    restart: always
    volumes:
      - cleaner_data:/app/working_copies
    expose:
      - "8002"
  ```
  - Add volumes `tableforge_data`, `tableforge_exports`, `cleaner_data` to the `volumes:` section

- [ ] **A-5.2** Update `deploy/nginx.conf` — add two new server blocks (HTTP redirect + HTTPS proxy):
  ```nginx
  # analyzer.fieldgovern.com
  server {
      listen 80;
      server_name analyzer.fieldgovern.com;
      location /.well-known/acme-challenge/ { root /var/www/certbot; }
      location / { return 301 https://$host$request_uri; }
  }
  server {
      listen 443 ssl;
      http2 on;
      server_name analyzer.fieldgovern.com;
      ssl_certificate     /etc/letsencrypt/live/analyzer.fieldgovern.com/fullchain.pem;
      ssl_certificate_key /etc/letsencrypt/live/analyzer.fieldgovern.com/privkey.pem;
      ssl_protocols TLSv1.2 TLSv1.3;
      client_max_body_size 200M;
      location / {
          proxy_pass http://analyzer:8001;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_read_timeout 300s;
      }
  }

  # cleaner.fieldgovern.com
  server {
      listen 80;
      server_name cleaner.fieldgovern.com;
      location /.well-known/acme-challenge/ { root /var/www/certbot; }
      location / { return 301 https://$host$request_uri; }
  }
  server {
      listen 443 ssl;
      http2 on;
      server_name cleaner.fieldgovern.com;
      ssl_certificate     /etc/letsencrypt/live/cleaner.fieldgovern.com/fullchain.pem;
      ssl_certificate_key /etc/letsencrypt/live/cleaner.fieldgovern.com/privkey.pem;
      ssl_protocols TLSv1.2 TLSv1.3;
      client_max_body_size 200M;
      location / {
          proxy_pass http://cleaner:8002;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_read_timeout 300s;
      }
  }
  ```

- [ ] **A-5.3** Check if GitHub Actions deploy workflow (`deploy-app.yml`) builds only the main `Dockerfile` — if so, update it to also `docker compose build analyzer cleaner` and restart those services on the VPS

**Effort:** ~2 hours | **Files:** `deploy/docker-compose.prod.yml`, `deploy/nginx.conf`, `.github/workflows/deploy-app.yml`

---

## Phase A-6: DNS + SSL on VPS (Manual Steps)

**Goal:** New subdomains resolve and have valid HTTPS certificates.

**Before you start:** Push the code to GitHub first so the deploy workflow runs and builds the two new Docker services on the VPS. Wait for the GitHub Action to finish (check the Actions tab in your repo).

---

### Step 1 — Add DNS records (takes 5–30 min to propagate)

Go to wherever you manage `fieldgovern.com` DNS (Namecheap, GoDaddy, Cloudflare, etc.).

Add **two new A records**:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `analyzer` | `178.238.227.32` | Auto / 300 |
| A | `cleaner` | `178.238.227.32` | Auto / 300 |

> **Namecheap:** Dashboard → fieldgovern.com → Advanced DNS → Add New Record
> **Cloudflare:** Dashboard → fieldgovern.com → DNS → Add record
> **GoDaddy:** My Products → fieldgovern.com → DNS → Add

After saving, **wait at least 10 minutes** before the next step. You can check propagation at https://dnschecker.org — search for `analyzer.fieldgovern.com` and wait until it shows your VPS IP.

---

### Step 2 — SSH into the VPS

Open a terminal (PowerShell or cmd) and run:

```
ssh fieldgovern@178.238.227.32 -i C:\Users\apran\.ssh\ssh-pavan1526
```

You should see a Linux prompt like `fieldgovern@vps:~$`

---

### Step 3 — Get SSL certificates

Once you're logged into the VPS, run these commands **one by one**:

```bash
cd /opt/fieldgovern
```

```bash
docker compose exec nginx nginx -t
```
> This checks nginx config is valid before you proceed. Should print `syntax is ok`.

```bash
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d analyzer.fieldgovern.com \
  -d cleaner.fieldgovern.com \
  --email apranjipavan2@gmail.com --agree-tos --non-interactive
```
> Certbot will contact Let's Encrypt and create SSL certificates. Takes ~30 seconds. If it fails with "DNS problem", wait another 5–10 min for DNS to propagate and retry.

```bash
docker compose exec nginx nginx -s reload
```
> Reloads nginx with the new SSL certificates. No downtime.

---

### Step 4 — Verify everything works

Open these URLs in your browser:

1. `https://analyzer.fieldgovern.com` → Should show the TableForge UI (blank, ready to load data)
2. `https://cleaner.fieldgovern.com` → Should show the DataCleaner UI (blank, ready to load data)

Then go to `https://app.fieldgovern.com`, open any program, and click **"Open in Analyzer"**. It should open `analyzer.fieldgovern.com` in a new tab and auto-load that program's submission data within a few seconds.

---

### If certbot fails

```bash
# Check if nginx is actually serving certbot challenges
curl http://analyzer.fieldgovern.com/.well-known/acme-challenge/test
# Should return 404 (not connection refused)

# If connection refused, the service isn't up:
docker compose ps
docker compose up -d nginx analyzer cleaner
```

**Effort:** ~30 min (manual) | **Verify:** Both URLs load over HTTPS, data auto-loads on launch

---

## Phase A Summary

| Phase | Description | Effort | Status |
|-------|-------------|--------|--------|
| A-0 | Move tools into repo | 30 min | ✅ Done |
| A-1 | FieldGovern export endpoint | 2 hr | ✅ Done |
| A-2 | Tool import endpoints | 3 hr | ✅ Done |
| A-3 | Frontend launch buttons | 2 hr | ✅ Done |
| A-4 | Dockerfiles for both tools | 2 hr | ✅ Done |
| A-5 | Docker Compose + nginx | 2 hr | ✅ Done |
| A-6 | ~~DNS + SSL~~ — dropped, using path-based routing | 0 min | ✅ Done |
| **Total** | | **~12 hr** | |

**Build order:** A-0 → A-1 → A-2 → A-3 → A-4 → A-5 → A-6 (push → VPS)

---

---

# Initiative B: Core Platform Features

> Full details in [`ROADMAP.md`](ROADMAP.md). Summarised here for priority context.

| # | Feature | Effort | Priority | Status |
|---|---------|--------|----------|--------|
| B-1 | Repeat groups (nested field sets) | High | Critical | ✅ Done |
| B-2 | Public survey URL | Med | High | ✅ Done |
| B-3 | Back-check / QC audit | Med | High | ✅ Done |
| B-4 | Duplicate detection | Low | High | ✅ Done |
| B-5 | Geofencing | Med | High | ✅ Done |
| B-6 | Server-side validation rules | Med | High | ✅ Done |
| B-7 | Stata / SPSS export | Low | High | ✅ Done |
| B-8 | DPDP compliance bundle | Med | Med | 📋 Planned |
| B-9 | Digital consent + signature | Low | Med | 📋 Planned |
| B-10 | Randomization / arm assignment | Low | Med | 📋 Planned |
| B-11 | Field scheduling / roster management | Med | Med | 📋 Planned |
| B-12 | DHIS2 push integration | High | Low | 📋 Planned |
| B-13 | WhatsApp notifications (MSG91) | Low | Blocked | 🔴 Needs MSG91 account |

---

---

# Initiative C: AI & Automation

| # | Feature | Effort | Priority | Status |
|---|---------|--------|----------|--------|
| C-1 | AI form builder assistant (skip logic from English) | Low | Med | 📋 Planned |
| C-2 | Auto-translate form labels (Hindi/regional) | Low | Med | 📋 Planned |
| C-3 | Analyzer + Cleaner: AI-assisted data corrections | Low | Med | Depends on A-2 |
| C-4 | FG Writer: export to Word / PDF | Med | Med | 📋 Planned |

---

---

# Initiative D: Compliance & Security

| # | Feature | Effort | Priority | Status |
|---|---------|--------|----------|--------|
| D-1 | DPDP 2023: consent audit log + data erasure | Med | Med | 📋 Planned |
| D-2 | Audit trail: all data-access events per user | Med | Med | 📋 Planned |
| D-3 | Purpose field on forms | Low | Low | 📋 Planned |

---

---

# Overall Status Snapshot (2026-04-26)

```
Platform MVP          ████████████████████  100% live
Repeat Groups         ████████████████████  100% done
Analytics Suite (FgAnalyzer/Cleaner/Writer) ████████████████████ 100% done
Analyzer Subdomain    ░░░░░░░░░░░░░░░░░░░░  0% — Initiative A
Cleaner Subdomain     ░░░░░░░░░░░░░░░░░░░░  0% — Initiative A
QC Bundle             ████████████████████  100% done
Core Backlog (B)      ████████████░░░░░░░░  ~60% done
AI Bundle (C)         ██████░░░░░░░░░░░░░░  ~30% done
Compliance (D)        ░░░░░░░░░░░░░░░░░░░░  0% planned
```
