# CLAUDE.md — FieldPulse (DataCollectTool)

This file is the authoritative guide for Claude Code when working in this repository.

---

## Project Overview

**FieldPulse** is a B2B SaaS platform for offline-first field data collection, targeting research teams in India. Competes directly with SurveyCTO at ₹18,000/month vs SurveyCTO's $225–630/month.

**Repo**: https://github.com/apranjipavan2-spec/DataCollectTool  
**Deployment**: Railway.app (Docker, single container, auto-deploy on push to `main`)  
**GitHub Pages**: `apranjipavan2-spec.github.io/DataCollectTool/` — served from `docs/` on `main`  
**Status**: MVP complete, production-deployed

---

## Architecture

### Single-Container Deployment
- Dockerfile builds frontend (Node 20) then serves static files from FastAPI backend (Python 3.13)
- One Railway service handles everything; PostgreSQL and Redis are Railway plugins
- Startup: `alembic upgrade head` → `seed_dev.py` → `uvicorn`

### Stack
| Layer | Tech |
|-------|------|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS 4 |
| PWA / Offline | vite-plugin-pwa, Workbox, OPFS + wa-sqlite (Chrome), IndexedDB + Dexie (Safari) |
| Backend | FastAPI 0.111 + SQLAlchemy 2.0 + Alembic |
| Database | PostgreSQL 16 |
| Cache | Redis 7 |
| Auth | JWT (HS256, 2h expiry) + bcrypt + API keys |
| Storage | Local disk (default), Google Drive, or AWS S3 |
| Languages | English, Hindi, Kannada, Telugu (i18next) |

---

## Directory Structure

```
DataCollectTool/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   │   ├── router.py
│   │   │   └── routes/          # auth, forms, submissions, sync, export, users,
│   │   │                        # tenants, api_keys, schedules, bulk_upload,
│   │   │                        # webhooks, notifications, import_excel
│   │   ├── core/
│   │   │   ├── config.py
│   │   │   ├── database.py      # SQLAlchemy engine, session, RLS
│   │   │   ├── deps.py          # get_current_user, require_role, require_enumerator
│   │   │   ├── security.py      # JWT, bcrypt
│   │   │   ├── storage.py       # Media storage abstraction
│   │   │   └── image_compress.py
│   │   ├── models/              # SQLAlchemy ORM models
│   │   └── services/            # email, webhooks, plan_enforcement, sheets
│   ├── alembic/versions/        # 0001–0016 migration files
│   ├── scripts/seed_dev.py      # Idempotent seed (Demo Org + Dataworx tenants)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # All routes + providers
│   │   ├── auth/                # Login (with demo quick-fill), ForgotPassword, Reset
│   │   ├── builder/             # Form builder + skip logic + versioning
│   │   ├── collect/             # FieldApp (offline collection, drafts, history + edit)
│   │   ├── dashboard/           # Dashboard (submissions table, serial_no, settings)
│   │   ├── admin/               # Master admin + Org admin panels
│   │   ├── renderer/            # FormRenderer + field components (GPS, photo, audio…)
│   │   ├── help/                # HelpContext, InfoButton, HelpPanel, HelpSpotlight
│   │   ├── storage/             # OpfsAdapter, IndexedDbAdapter
│   │   ├── i18n/locales/        # en.json, hi.json, kn.json, te.json
│   │   └── lib/                 # api.ts, formUtils, navigation, branding, push
│   ├── vite.config.ts
│   └── package.json
├── docs/                        # GitHub Pages (synced from website/)
├── website/                     # Marketing landing page
├── Dockerfile                   # Multi-stage: Node build → Python serve
├── docker-compose.yml
├── railway.toml
└── gen-context.config.json      # SigMap config
```

---

## Key API Endpoints

Base path: `/api/v1`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | public | Phone + password → JWT |
| POST | `/auth/refresh` | public | Refresh token → new tokens |
| GET | `/forms/` | enumerator+ | List active forms |
| POST | `/forms/` | org_admin+ | Create form |
| POST | `/sync/push` | enumerator+ | Batch offline submissions (assigns serial_no) |
| GET | `/sync/pull` | enumerator+ | Pull form schemas for offline cache |
| POST | `/sync/media` | enumerator+ | Upload photo/audio for a submission |
| GET | `/submissions/` | enumerator+ | List (enumerators see own only) |
| GET | `/submissions/{id}` | enumerator+ | Detail (enumerators see own only) |
| PATCH | `/submissions/{id}` | supervisor+ | Flag / approve / reject |
| PATCH | `/submissions/{id}/data` | enumerator+ | Edit data_json (enumerator: own + tenant allows) |
| PATCH | `/submissions/{id}/serial-no` | master_admin | Change serial number |
| POST | `/bulk-upload/parse` | org_admin+ | Parse Excel → suggested column mapping |
| POST | `/bulk-upload/apply` | org_admin+ | Apply mapping → create submissions |
| GET | `/bulk-upload/template/{form_id}` | org_admin+ | Download pre-formatted Excel template |
| GET | `/tenants/branding` | any auth | Tenant logo, colors, allow_enumerator_edit |
| PATCH | `/tenants/{id}` | org_admin+ | Update settings incl. allow_enumerator_edit |
| GET | `/export/submissions/{form_id}/csv` | supervisor+ | CSV export |
| GET | `/health` | public | Railway health check |

---

## User Roles

| Role | Access |
|------|--------|
| `master_admin` | Platform-wide: tenants, serial numbers, all data |
| `org_admin` | Org-wide: forms, users, API keys, branding, bulk upload |
| `supervisor` | Team lead: flag/approve submissions, assign forms, export |
| `enumerator` | Data collector: fill forms, sync, edit own records (if tenant allows) |

---

## Database Migrations

Current: **0016** migrations (`backend/alembic/versions/0001_…0016_…`).

Key additions:
- **0016**: `submissions.serial_no` (auto-assigned per tenant on sync), `tenants.allow_enumerator_edit` (default true)

To add a new migration:
```bash
cd backend
python -m alembic revision --autogenerate -m "describe change"
python -m alembic upgrade head
```
Follow `0001_`, `0002_` … naming pattern.

---

## Demo / Test Credentials

Seeded by `scripts/seed_dev.py` (idempotent, runs on every Railway deploy).

### Demo Org (tenant: "Demo Org", plan: professional)
| Phone | Password | Role |
|-------|----------|------|
| +918317390926 | superadmin@4991 | master_admin (Pavan Deshetty — platform super admin) |
| +919999990001 | test@123 | org_admin (Admin User) |
| +918123105186 | test@123 | org_admin (PavanDeshetty) |
| +919999990002 | test@123 | supervisor |
| +919999990003 | test@123 | enumerator (Rajesh Kumar) |
| +919999990004 | test@123 | enumerator (Priya Sharma) |

### Platform (tenant: "FieldPulse Platform")
| Phone | Password | Role | Name |
|-------|----------|------|------|
| +919999990000 | test@123 | master_admin | Master Admin |
| +918317390926 | superadmin@4991 | master_admin | Pavan Deshetty |

Login page has a **"Try a demo account"** quick-fill button for Admin / Supervisor / Enumerator.

---

## Environment Variables

**Required** (set as Railway env vars, never commit):
```
DATABASE_URL          # PostgreSQL (auto-set by Railway plugin)
REDIS_URL             # Redis (auto-set by Railway plugin)
JWT_SECRET            # Min 32-char random string
STORAGE_BACKEND       # local | drive | s3
CORS_ORIGINS          # Comma-separated allowed origins
```

**Optional:**
```
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
GDRIVE_FOLDER_ID / GDRIVE_CLIENT_SECRET_PATH
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_S3_BUCKET
```

---

## Local Development

```bash
# 1. Start postgres + redis
docker compose up -d

# 2. Backend
cd backend
pip install -r requirements.txt
cp .env.example .env   # fill in values
python -m alembic upgrade head
python scripts/seed_dev.py
python -m uvicorn app.main:app --port 8000 --reload

# 3. Frontend
cd frontend
npm install
npm run dev            # → http://localhost:5173
```

---

## Key Features Built

| Feature | Where |
|---------|-------|
| Offline-first PWA | `collect/FieldApp.modern.tsx`, `storage/`, `sw.ts` |
| Form builder + skip logic | `builder/FormBuilder.modern.tsx` |
| Auto-advance on single-tap | `renderer/FormRenderer.tsx` (`AUTO_ADVANCE_TYPES`) |
| GPS capture + clear | `renderer/fields/GpsField.tsx` |
| Photo capture + delete | `renderer/fields/PhotoField.tsx` |
| Bulk upload (Excel, org_admin+) | `backend/app/api/routes/bulk_upload.py` |
| Contextual help system | `help/` — InfoButton, HelpPanel, HelpSpotlight |
| Serial numbers on submissions | migration 0016, `sync.py`, `submissions.py` |
| Enumerator edit own records | `PATCH /submissions/{id}/data`, tenant toggle |
| History edit in FieldApp | `collect/FieldApp.modern.tsx` screen=editing |
| Dashboard serial_no column | `dashboard/Dashboard.modern.tsx` |
| Allow-enumerator-edit toggle | Dashboard → Integrations → Org Settings |
| Demo quick-fill on login | `auth/LoginPage.tsx` |

---

## Sensitive Files — Never Commit

- `backend/.env`
- `credentials.csv` / `export_credentials.py`
- `backend/credentials/` (Google OAuth tokens)
- `*.key`, `*_token.json`, `*_secret*`

`TEST_CREDENTIALS.csv` is tracked (demo passwords only — intentional).

---

## AI Tools Active in This Project

### 1. Caveman (`/caveman`)
Skill at `.claude/skills/caveman/SKILL.md`. Ultra-compressed token-saving mode (~75% reduction).
- `/caveman` — activate full mode
- `/caveman lite` — terse but full sentences
- `/caveman ultra` — maximum compression
- `/caveman:compress CLAUDE.md` — compress this file to save tokens
- `stop caveman` / `normal mode` — deactivate

### 2. SigMap (signature context — always active)
Config: `gen-context.config.json`. Output: `.github/copilot-instructions.md` (hot) + `.github/context-cold.md` (cold).
- Regenerate after schema/route changes: `npx sigmap`
- MCP server registered in `.claude/settings.local.json`

### 3. Graphify (`/graphify`)
Installed globally. Builds interactive knowledge graph of codebase.
- `/graphify .` — full project graph
- Output: `graphify-out/graph.html`, `GRAPH_REPORT.md`

### 4. Claude-mem (persistent memory)
Auto-saves session context. Memory files at `~/.claude/projects/C--Users-apran/memory/`.
