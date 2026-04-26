# CLAUDE.md — FieldGovern

> Authoritative guide for Claude Code. Read `tasks/todo.md` + `tasks/lessons.md` at session start.
> **MASTER ROADMAP:** `planning/MASTER_ROADMAP.md` — single source of truth for all initiatives. Start here for any new work.
> **DEPLOYMENT SESSION:** Read `process_deployment.md` first (local only, has credentials + full process).
> **TOOLS (Analyzer/Cleaner):** `deploy-knowledge/TOOLS_DEV_GUIDE.md` — where to edit TableForge & DataCleaner, deploy flow, patterns, gotchas.

---

# Workflow Orchestration

## 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately
- Use plan mode for verification steps, not just building

## 2. Subagent Strategy
- Use subagents for research, exploration, and parallel analysis to keep main context clean
- One task per subagent for focused execution

## 3. Self-Improvement Loop
- After ANY correction: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake
- Review lessons at session start for relevant project

## 4. Verification Before Done
- Never mark a task complete without proving it works
- Run TS check (`npx tsc --noEmit --skipLibCheck`) after frontend changes
- Check API routes are registered in `router.py` after backend changes

## 5. Demand Elegance (Balanced)
- For non-trivial changes: ask "is there a more elegant way?"
- Skip for simple obvious fixes — don't over-engineer

## 6. Autonomous Bug Fixing
- Bug report → just fix it. Point at the root cause and resolve it.

---

# Task Management

1. **Plan First:** Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan:** Check in before starting implementation
3. **Track Progress:** Mark items complete as you go
4. **Explain Changes:** High-level summary at each step
5. **Document Results:** Add review section to `tasks/todo.md`
6. **Capture Lessons:** Update `tasks/lessons.md` after corrections

---

# Core Principles

- **Simplicity First:** Make every change as simple as possible. Impact minimal code.
- **No Laziness:** Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact:** Only touch what's necessary. No side effects.

---

# Project Overview

**FieldGovern** — B2B SaaS for offline-first field data collection. Targets Indian research teams. Competes with SurveyCTO at ₹18,000/month vs $225–630/month.

**Repo:** https://github.com/apranjipavan2-spec/DataCollectTool  
**Deploy:** GitHub Actions → Docker → VPS at `/opt/fieldgovern`  
**GitHub Pages:** `docs/` on main → edit `website/`, push — workflow auto-copies to `docs/`. Never edit `docs/` directly. See `process_deployment.md` for full details.  
**Status:** MVP live, production-deployed

---

# Architecture

### Stack
| Layer | Tech |
|-------|------|
| Frontend | React 18 + TS + Vite + Tailwind 4 |
| PWA/Offline | vite-plugin-pwa, Workbox, OPFS + wa-sqlite (Chrome), IndexedDB (Safari) |
| Backend | FastAPI 0.111 + SQLAlchemy 2.0 + Alembic |
| DB | PostgreSQL 16 + Redis 7 |
| Auth | JWT HS256 (2h) + bcrypt + API keys |

### Single-Container Deploy
- Dockerfile: Node 20 build → Python 3.13 serve static + API
- Startup: `wait_and_stamp.py` → `alembic upgrade head` → `seed_dev.py` → uvicorn
- VPS secrets (GitHub → Environments → production): `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `GHCR_PAT`

---

# Key Rules (learned from mistakes — see tasks/lessons.md)

1. **New migration → always add patch to `seed_dev.py` `_PATCHES` + detection line in `wait_and_stamp.py`**
2. **New route file → always import + `include_router` in `app/api/router.py`**
3. **New nav item → always add matching `<Route>` in `App.tsx`**
4. **User dependency is a dict**: use `user["tenant_id"]`, not `user.tenant_id`
5. **TopNav breadcrumbs**: use `path` not `href`
6. **localStorage**: always namespace by entity ID (e.g. `fg_tabs_{programId}`)

---

# Directory Structure

```
DataCollectTool/
├── backend/app/
│   ├── main.py
│   ├── api/
│   │   ├── router.py               ← register all routers here
│   │   └── routes/
│   │       ├── auth, forms, submissions, sync, export, users
│   │       ├── tenants, notifications, api_keys, webhooks
│   │       ├── reports, templates, import_excel, bulk_upload
│   │       ├── programs, admin_monitor, ai, public_survey
│   │       ├── roster, analytics, locations
│   │       ├── field_govern.py     ← FG Analyzer/Cleaner/Tabulator/Writer/Panel Study
│   │       └── migration/router.py
│   ├── core/
│   │   ├── database.py             ← RLS via set_tenant_context()
│   │   ├── deps.py                 ← get_current_user, require_role (returns dict)
│   │   └── config.py               ← CORS_ORIGINS env var
│   ├── models/                     ← SQLAlchemy ORM models
│   └── services/ai_service.py      ← suggest_tabulation, generate_program_report
├── backend/alembic/versions/       ← 0001–0025 migrations
├── backend/scripts/
│   ├── seed_dev.py                 ← idempotent seed + schema patches 0001–0025
│   └── wait_and_stamp.py           ← detects DB revision, stamps alembic_version
├── frontend/src/
│   ├── App.tsx                     ← all routes
│   ├── lib/
│   │   ├── api.ts                  ← axios, JWT attach, refresh
│   │   ├── navigation.ts           ← getNavItems per role
│   │   └── fgStorage.ts            ← localStorage for tabulations + reports
│   ├── programs/
│   │   ├── ProgramsPage.tsx        ← program list + detail + Field Govern button
│   │   ├── FgAnalyzer.tsx          ← /fg/analyzer (Overview, Tabulator AI, Panel Study)
│   │   ├── FgCleaner.tsx           ← /fg/cleaner (quality table, issue filters)
│   │   └── FieldGovern.tsx         ← /programs/:id/govern (quick-access, all tabs)
│   └── reports/FgWriter.tsx        ← /fg/writer (program-aware, uses fgStorage)
├── tasks/
│   ├── todo.md                     ← sprint board
│   └── lessons.md                  ← mistake patterns + prevention rules
├── planning/
│   ├── ROADMAP.md                  ← full feature backlog
│   ├── ANALYTICS_SUITE_ROADMAP.md  ← FG Analyzer/Cleaner/Writer/Tabulator plan
│   └── PENDING_MANUAL.md           ← items needing external credentials
├── website/                        ← marketing pages (copy to docs/ before push)
└── docs/                           ← GitHub Pages (never edit directly)
```

---

# API Base Path: `/api/v1`

### Key endpoints (partial — see code for full list)

| Method | Path | Min Role | Description |
|--------|------|----------|-------------|
| POST | `/auth/login` | public | Phone + password → JWT |
| GET | `/forms/` | enumerator | List forms |
| POST | `/sync/push` | enumerator | Batch offline submissions |
| GET | `/submissions/` | enumerator | List (own only for enumerators) |
| PATCH | `/submissions/{id}` | supervisor | Flag / approve |
| GET | `/fg/programs/{id}/analyzer-data` | supervisor | KPIs, trend, enumerators, columns |
| GET | `/fg/programs/{id}/cleaner` | supervisor | Paginated quality view |
| POST | `/fg/programs/{id}/tabulate/suggest` | supervisor | AI suggests tables |
| POST | `/fg/programs/{id}/tabulate/execute` | supervisor | Run aggregation |
| POST | `/fg/programs/{id}/writer/generate` | supervisor | AI report from program data |
| GET | `/fg/programs/{id}/waves` | supervisor | Wave list |
| PUT | `/fg/programs/{id}/waves` | org_admin | Set wave on questionnaire |
| GET | `/fg/programs/{id}/attrition` | supervisor | Panel study attrition |
| GET | `/export/submissions/{form_id}/csv` | supervisor | CSV export |

---

# User Roles

| Role | Access |
|------|--------|
| `master_admin` | Platform-wide: tenants, all data, serial numbers |
| `org_admin` | Org-wide: forms, users, API keys, branding, FG tools |
| `supervisor` | Flag/approve submissions, FG Analyzer/Cleaner/Writer, export |
| `enumerator` | Fill forms, sync, edit own records (if tenant allows) |

---

# Database Migrations

Current: **0025** (`backend/alembic/versions/`)

| Migration | Key Change |
|-----------|-----------|
| 0016 | `submissions.serial_no`, `tenants.allow_enumerator_edit` |
| 0017 | Programs, participant_types, questionnaires, location_targets tables |
| 0018 | `submissions.{program_id, questionnaire_id, location_id, ...}` |
| 0019 | `tenants.notification_config`, `forms.sheets_sync_config` |
| 0020 | `submissions.{has_violations, consent_given, backcheck_*}` |
| 0021 | `forms.{public_token, is_public}`, `respondent_roster` table |
| 0022 | `tenants.ai_config` |
| 0023 | `submissions.roster_id`, `respondent_roster.extra_data` |
| 0024 | `locations` table, `respondent_roster.location_id` |
| 0025 | `program_questionnaires.{wave_number, wave_label, panel_key}`, `programs.is_panel_study`, `submissions.household_id` |

**Add migration:**
```bash
cd backend
python -m alembic revision --autogenerate -m "describe change"
python -m alembic upgrade head
# Then add IF NOT EXISTS patch to seed_dev.py + detection to wait_and_stamp.py
```

---

# CORS & Security

- **CORS:** `CORSMiddleware` with `allow_origins=settings.cors_origins` (from `CORS_ORIGINS` env var), `allow_credentials=True`, all methods + headers
- **RLS:** `set_tenant_context(db, tenant_id)` called in `deps.py` on every authenticated request; PostgreSQL `current_setting('app.current_tenant')` used in RLS policies
- **All FG endpoints:** filter by `tenant_id` explicitly on every query; role-guarded by `require_supervisor` or `require_org_admin`
- **API Keys:** separate auth path, same tenant_id enforcement

---

# Demo Credentials

| Tenant | Phone | Password | Role |
|--------|-------|----------|------|
| Demo Org | +919999990001 | test@123 | org_admin |
| Demo Org | +919999990002 | test@123 | supervisor |
| Demo Org | +919999990003 | test@123 | enumerator |
| Platform | +918317390926 | superadmin@4991 | master_admin |
| Dataworx | +919999991001 | test@123 | org_admin |

---

# Environment Variables

```
DATABASE_URL      # PostgreSQL
REDIS_URL         # Redis
JWT_SECRET        # ≥32 chars
CORS_ORIGINS      # comma-separated allowed origins
STORAGE_BACKEND   # local | drive | s3
SENTRY_DSN        # optional — backend error monitoring
```

Frontend build vars (via GitHub Actions secrets):
```
VITE_SENTRY_DSN   # optional — frontend error monitoring
```

---

# Key Features Built

| Feature | File / Route |
|---------|-------------|
| Offline PWA | `collect/FieldApp.modern.tsx` + `storage/` + `sw.ts` |
| Form builder + skip logic | `builder/FormBuilder.modern.tsx` |
| Bulk upload (Excel) | `routes/bulk_upload.py` |
| Platform migration (XLSForm/Kobo/ODK) | `routes/migration/` + `migration/MigrationPage.tsx` |
| WhatsApp notifications | `services/whatsapp.py` |
| Google Sheets sync | `services/sheets_sync.py` |
| FG Analyzer | `programs/FgAnalyzer.tsx` + `/fg/programs/{id}/analyzer-data` |
| FG Cleaner | `programs/FgCleaner.tsx` + `/fg/programs/{id}/cleaner` |
| FG Tabulator (AI) | inside FgAnalyzer + `/fg/programs/{id}/tabulate/{suggest,execute}` |
| FG Writer | `reports/FgWriter.tsx` + `/fg/programs/{id}/writer/generate` |
| Panel Study + Attrition | inside FgAnalyzer + `/fg/programs/{id}/{waves,attrition}` |
| AI multi-LLM | `services/ai_service.py` — OpenAI / Anthropic / Gemini per-tenant |
| Contextual help | `help/` — InfoButton, HelpPanel, HelpSpotlight |
| Sentry monitoring | `main.py` + `main.tsx` (conditional on DSN) |

---

# AI Tools

### 1. Caveman (`/caveman`)
Skill at `.claude/skills/caveman/SKILL.md`. ~75% token reduction. Levels: lite, full, ultra.

### 2. SigMap (always active)
`npx sigmap` — regenerates `.github/copilot-instructions.md` after schema/route changes.

### 3. Graphify (`/graphify`)
Global skill. Builds interactive knowledge graph. Outputs `graphify-out/graph.html`.

### 4. Claude-mem (auto-memory)
Memory files at `~/.claude/projects/C--Users-apran/memory/`.

---

# Roadmap Status (see `planning/MASTER_ROADMAP.md` — master; `planning/ROADMAP.md` — feature backlog)

| Bundle | Status |
|--------|--------|
| Migration (XLSForm/Kobo/ODK/SurveyCTO) | ✅ Done |
| Google Sheets sync | ✅ Done |
| WhatsApp notifications | ✅ Done (pending MSG91 account) |
| AI report writer | ✅ Done (FG Writer) |
| FG Analyzer + Tabulator + Panel Study | ✅ Done |
| FG Cleaner | ✅ Done |
| Repeat groups | 📋 Planned (highest priority) |
| Public survey URL | 📋 Planned (schema ready) |
| Back-check / QC audit | 📋 Planned |
| Stata/SPSS export | 📋 Planned |
| DHIS2 integration | 📋 Planned |

---

# Sensitive Files — Never Commit
`backend/.env`, `credentials.csv`, `export_credentials.py`, `backend/credentials/`, `*.key`, `*_token.json`, `*_secret*`
