# CLAUDE.md — FieldPulse (DataCollectTool)

This file is the authoritative guide for Claude Code when working in this repository.

---

## Project Overview

**FieldPulse** is a B2B SaaS platform for offline-first field data collection, targeting research teams in India. It competes directly with SurveyCTO at ₹18,000/month (~$215) vs SurveyCTO's $225–630/month.

**Repo**: https://github.com/apranjipavan2-spec/DataCollectTool  
**Deployment**: Railway.app (Docker, single container)  
**Status**: MVP complete, production-ready

---

## Architecture

### Single-Container Deployment
- Dockerfile builds frontend (Node 20) then serves it as static files from the FastAPI backend (Python 3.13)
- One Railway service handles everything; PostgreSQL and Redis are Railway plugins
- Railway auto-deploys on push to `main`

### Stack
| Layer | Tech |
|-------|------|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS 4 |
| PWA / Offline | vite-plugin-pwa, Workbox, OPFS + wa-sqlite (Chrome), IndexedDB + Dexie (Safari) |
| Backend | FastAPI 0.111 + SQLAlchemy 2.0 + Alembic |
| Database | PostgreSQL 16 |
| Cache | Redis 7 |
| Auth | JWT (HS256, 2h expiry) + bcrypt API keys |
| Storage | Local disk (default), Google Drive, or AWS S3 |
| Languages | English, Hindi, Kannada, Telugu (i18next) |

---

## Directory Structure

```
DataCollectTool/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, CORS, middleware
│   │   ├── api/
│   │   │   ├── router.py        # Aggregates all route modules
│   │   │   └── routes/          # auth, forms, submissions, sync, export, users, tenants, api_keys, ...
│   │   ├── core/
│   │   │   ├── config.py        # Settings from env vars
│   │   │   ├── database.py      # SQLAlchemy engine, session, RLS
│   │   │   ├── deps.py          # Auth dependencies (get_current_user)
│   │   │   ├── security.py      # JWT, bcrypt helpers
│   │   │   └── storage.py       # Media storage abstraction
│   │   ├── models/              # SQLAlchemy ORM models
│   │   ├── schemas/             # Pydantic request/response schemas
│   │   └── services/            # Email, webhooks, plan enforcement, Sheets
│   ├── alembic/versions/        # 15 migration files (0001–0015)
│   ├── scripts/
│   │   └── seed_dev.py          # Creates demo tenant + all 4 role users
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # All routes + providers
│   │   ├── sw.ts                # Service Worker (background sync)
│   │   ├── auth/                # Login, ForgotPassword, ResetPassword
│   │   ├── builder/             # Form builder + skip logic + versioning
│   │   ├── collect/             # Field data entry (FieldApp)
│   │   ├── dashboard/           # Submission list + detail modal
│   │   ├── admin/               # Master admin + Org admin panels
│   │   ├── storage/             # OpfsAdapter, IndexedDbAdapter
│   │   ├── i18n/locales/        # en.json, hi.json, kn.json, te.json
│   │   └── lib/                 # api.ts, formDraft.ts, branding.ts, pushNotifications.ts
│   ├── vite.config.ts
│   └── package.json
├── Dockerfile                   # Multi-stage: Node build → Python serve
├── docker-compose.yml           # Local: postgres + redis
├── railway.toml                 # Railway deploy config
└── .env.example                 # Template for required env vars
```

---

## Key API Endpoints

Base path: `/api/v1`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Phone + password → JWT |
| POST | `/auth/refresh` | Refresh token → new tokens |
| GET | `/forms/` | List forms (org_admin+) |
| POST | `/forms/` | Create form |
| POST | `/sync/push` | Enumerator syncs offline submissions |
| GET | `/sync/pull` | Pull forms for offline cache |
| GET | `/submissions/` | List with filters + pagination |
| GET | `/export/submissions/{form_id}/csv` | CSV export |
| POST | `/api-keys/` | Generate API key |
| GET | `/tenants/branding` | Tenant white-label config |
| GET | `/health` | Health check (used by Railway) |

---

## User Roles

| Role | Access |
|------|--------|
| `master_admin` | Platform-wide: create/manage tenants |
| `org_admin` | Org-wide: forms, users, API keys, branding |
| `supervisor` | Team lead: view/flag submissions, assign forms, export |
| `enumerator` | Data collector: fill forms, sync submissions |

---

## Environment Variables

**Required for Railway deployment** (set as Railway environment variables, never commit):

```
DATABASE_URL          # PostgreSQL connection string (auto-set by Railway plugin)
REDIS_URL             # Redis connection string (auto-set by Railway plugin)
JWT_SECRET            # Min 32-char random string
STORAGE_BACKEND       # local | drive | s3  (use "local" to start)
CORS_ORIGINS          # Comma-separated allowed origins
```

**Optional:**
```
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD   # Email (password reset)
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY                # Push notifications
GDRIVE_FOLDER_ID / GDRIVE_CLIENT_SECRET_PATH        # Google Drive storage
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_S3_BUCKET  # S3 storage
```

---

## Local Development

```bash
# 1. Start database + cache
docker compose up -d

# 2. Backend
cd backend
pip install -r requirements.txt
cp .env.example .env          # then fill in values
python -m alembic upgrade head
python scripts/seed_dev.py    # creates demo users
python -m uvicorn app.main:app --port 8000 --reload

# 3. Frontend (separate terminal)
cd frontend
npm install
npm run dev                   # → http://localhost:5173
```

### Demo / Test Credentials (local seed only)
| Phone | Password | Role |
|-------|----------|------|
| +919999990001 | test@123 | Master Admin |
| +919999990002 | test@123 | Org Admin |
| +919999990003 | test@123 | Supervisor |
| +919999990004 | test@123 | Enumerator |

---

## Deployment (Railway)

The repo is connected to Railway and auto-deploys on push to `main`.

**Startup sequence** (defined in `railway.toml`):
1. `alembic upgrade head` — runs DB migrations
2. `python scripts/seed_dev.py || true` — seeds demo data (idempotent)
3. `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

**Required Railway plugins**: PostgreSQL 16, Redis 7

**Health check**: GET `/health` — must return 200 within 60s of deploy

---

## Database Migrations

Always create new Alembic migrations for schema changes:

```bash
cd backend
python -m alembic revision --autogenerate -m "describe change"
python -m alembic upgrade head
```

Migration files go in `backend/alembic/versions/`. Follow the `0001_`, `0002_` naming pattern.

---

## Sensitive Files — Never Commit

- `backend/.env` — real secrets (already in .gitignore)
- `credentials.csv` — real user credentials
- `export_credentials.py` — credential export script
- `backend/credentials/` — Google OAuth tokens/keys
- Any `*.key`, `*_token.json`, `*_secret*` files

`TEST_CREDENTIALS.csv` is tracked in git (contains only demo test passwords — intentional).

---

## Current Work / Roadmap

- [x] Phase 1: Auth, forms, multi-tenant
- [x] Phase 2: Offline collection, sync, dashboard, media, export
- [x] Phase 3: API keys, white-labeling, plan enforcement, webhooks
- [x] Phase 4: Push notifications, session timeout, i18n, themes
- [ ] Marketing website (fieldpulse-site) — in progress
- [ ] Railway production deployment
- [ ] Demo tenant with pre-seeded data
- [ ] Webhook delivery (configured but not firing)
- [ ] Play Store (TWA) — `twa/` directory ready

---

## AI Tools Active in This Project

Three tools are integrated and available in every session:

### 1. Caveman (`/caveman`)
Skill at `.claude/skills/caveman/SKILL.md`. Ultra-compressed token-saving mode (~75% reduction).
- `/caveman` — activate full mode
- `/caveman lite` — terse but full sentences
- `/caveman ultra` — maximum compression
- `/caveman:compress CLAUDE.md` — compress this file to save tokens every session
- `stop caveman` / `normal mode` — deactivate

### 2. Claude-mem (persistent memory)
Installed globally at `~/.claude/plugins/marketplaces/thedotmack/`. Captures tool usage, compresses observations, injects context at session start. Worker runs on port 37777.
- `/mem-search` — search past sessions ("did we fix X before?", "how did we do Y?")
- `/make-plan` — phased implementation plan with documentation discovery
- `/do` — execute a plan using subagents
- `/smart-explore` — intelligent codebase exploration
- `/timeline-report` — what changed across sessions

**Source**: `C:\Life\DataCollectTool\claude-mem-main\claude-mem-main\`

### 3. Hermes Agent (Nous Research)
Separate self-improving agent framework at `C:\Life\DataCollectTool\hermes-agent-main\hermes-agent-main\`. NOT a Claude Code plugin — runs independently. Relevant capabilities:
- **Docker management** skill (`optional-skills/devops/docker-management/`) — useful for Railway/Docker ops
- **Scheduled automations** — cron jobs, nightly backups
- **Multi-platform messaging** — Telegram, Discord, Slack integration
- **Subagent parallelization** — spawn isolated agents for parallel workstreams
- Install: `curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash` (WSL2 required on Windows)

**When to use Hermes**: When you need an autonomous agent running outside Claude Code sessions (e.g., nightly data exports, monitoring, multi-platform notifications for FieldPulse events).

---

## Code Conventions

- **Backend**: FastAPI dependency injection via `Depends()`. All DB queries filtered by `tenant_id`. Use `get_db` and `get_current_user` from `core/deps.py`.
- **Frontend**: Zustand for global state. All API calls go through `src/lib/api.ts`. Storage operations via `StorageAdapter` abstraction (never call OPFS/IndexedDB directly).
- **Migrations**: One migration per logical change. Never edit existing migration files.
- **No comments** unless the WHY is non-obvious.
