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
7. **Migrations — never use `CONCURRENTLY`**: `CREATE INDEX CONCURRENTLY` requires autocommit but Alembic wraps migrations in a transaction. Use plain `CREATE INDEX IF NOT EXISTS`. Same for `DROP INDEX CONCURRENTLY`.
8. **Migrations — always idempotent**: Use `ADD COLUMN IF NOT EXISTS` via `op.get_bind().execute(sa.text(...))` — never `op.add_column()` which errors if column exists. Production DBs may have columns applied manually out of order.
9. **Vite manualChunks — vendor only**: Never put `/src/` app code in `manualChunks`. Grouping app modules creates cross-chunk circular TDZ crashes. Only vendor packages (react, recharts, d3) belong in manual chunks. App chunks are created automatically by `React.lazy()` in App.tsx.
10. **Leaflet**: Already installed as npm package. Always `import L from 'leaflet'` + `import 'leaflet/dist/leaflet.css'`. Never load from CDN — CSP blocks it. Map tiles need `https://*.tile.openstreetmap.org` in CSP `img-src`.

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
│   │       ├── comments.py, inbox.py, user_tool_projects.py
│   │       ├── billing.py, scheduled_reports.py
│   │       └── migration/router.py
│   ├── core/
│   │   ├── database.py             ← RLS via set_tenant_context()
│   │   ├── deps.py                 ← get_current_user, require_role (returns dict)
│   │   └── config.py               ← CORS_ORIGINS env var
│   ├── models/                     ← SQLAlchemy ORM models (includes ScheduledReport, UsageRecord)
│   ├── services/
│   │   ├── ai_service.py           ← suggest_tabulation, generate_program_report, suggest_skip_logic
│   │   ├── email.py                ← send_email (supports DOCX attachments via MIMEApplication)
│   │   └── scheduled_reports.py    ← run_scheduled_reports, _md_to_docx_bytes, _should_run_now
├── backend/alembic/versions/       ← 0001–0035 migrations
├── backend/scripts/
│   ├── seed_dev.py                 ← idempotent seed + schema patches 0001–0035
│   └── wait_and_stamp.py           ← detects DB revision, stamps alembic_version
├── frontend/src/
│   ├── App.tsx                     ← all routes
│   ├── lib/
│   │   ├── api.ts                  ← axios, JWT attach, refresh
│   │   ├── navigation.ts           ← getNavItems per role
│   │   └── fgStorage.ts            ← localStorage for tabulations + reports; saveAnalyzerToolProject()
│   ├── programs/
│   │   ├── ProgramsPage.tsx        ← program list + detail + Field Govern button
│   │   ├── FgAnalyzer.tsx          ← /fg/analyzer (Overview, Tabulator AI, Panel Study)
│   │   ├── FgCleaner.tsx           ← /fg/cleaner (quality table, issue filters)
│   │   └── FieldGovern.tsx         ← /programs/:id/govern (quick-access, all tabs)
│   ├── reports/FgWriter.tsx        ← /fg/writer (program-aware, uses fgStorage, ScheduleModal)
│   └── dashboard/
│       ├── Dashboard.modern.tsx    ← tab router (overview/submissions/analytics/scorecard/forms/team)
│       └── ScorecardTab.tsx        ← enumerator performance scorecard (lazy-loaded)
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
| GET | `/submissions/enumerator-scorecard` | supervisor | Enumerator performance scorecard |
| GET | `/scheduled-reports/` | supervisor | List scheduled reports |
| POST | `/scheduled-reports/` | supervisor | Create scheduled report |
| PATCH | `/scheduled-reports/{id}` | supervisor | Update scheduled report |
| DELETE | `/scheduled-reports/{id}` | supervisor | Delete scheduled report |
| POST | `/ai/suggest-skip-logic` | supervisor | AI skip logic from plain English |
| POST | `/tool-projects/` | supervisor | Save Analyzer tabulation to Files menu |

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

Current: **0035** (`backend/alembic/versions/`)

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
| 0026–0029 | Program analysis, backcheck, program location, user tool projects |
| 0030 | Indexes on `submissions` for program/tenant/enumerator/questionnaire queries |
| 0031 | `forms.allow_enumerator_edit`, `programs.allow_enumerator_edit` |
| 0032 | Partial index on `data_json->>'_duplicate_suspect'` |
| 0033 | Composite index on `submissions(tenant_id, form_id)` |
| 0034 | `billing` — `usage_records`, `plan_limits` tables |
| 0035 | `scheduled_reports` table — cron-based email delivery of FG Writer reports |

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
| FG Writer + Schedule | `reports/FgWriter.tsx` + `/fg/programs/{id}/writer/generate`; `ScheduleModal` for cron delivery |
| Panel Study + Attrition | inside FgAnalyzer + `/fg/programs/{id}/{waves,attrition}` |
| Enumerator Scorecard | `dashboard/ScorecardTab.tsx` + `GET /submissions/enumerator-scorecard` |
| AI Skip Logic Builder | `builder/SkipLogicEditor.tsx` AiSkipPanel + `POST /ai/suggest-skip-logic` |
| Scheduled Reports | `services/scheduled_reports.py` + model `ScheduledReport` + APScheduler hourly |
| Analyzer → Files | `fgStorage.ts:saveAnalyzerToolProject()` — tabulations auto-saved as CSV tool projects |
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
| Enumerator Scorecard | ✅ Done |
| AI Skip Logic Builder | ✅ Done |
| Scheduled Reports | ✅ Done |
| Analyzer → Files menu | ✅ Done |
| Repeat groups | ✅ Done |
| Public survey URL | ✅ Done |
| Back-check / QC audit | ✅ Done |
| Stata/SPSS export | ✅ Done |
| DHIS2 integration | 📋 Planned |

---

# Sensitive Files — Never Commit
`backend/.env`, `credentials.csv`, `export_credentials.py`, `backend/credentials/`, `*.key`, `*_token.json`, `*_secret*`


## Auto-generated signatures
<!-- Updated by gen-context.js -->
# Code signatures

## deps
```
backend\app\api\routes\billing.py ← fastapi, pydantic, sqlalchemy, app
backend\app\api\routes\field_govern.py ← fastapi, pydantic, sqlalchemy, app, pandas
backend\app\api\routes\programs.py ← fastapi, pydantic, sqlalchemy, app
backend\app\api\routes\shared_files.py ← fastapi, pydantic, sqlalchemy, app
backend\app\api\routes\user_tool_projects.py ← fastapi, sqlalchemy, pydantic, app
backend\app\models\shared_file.py ← sqlalchemy, app
backend\app\models\user_tool_project.py ← sqlalchemy, app
```

## backend

### backend\app\api\routes\billing.py
```
class RequestPaymentIn(BaseModel) {plan_id*, billing_cycle?}
class SubmitUTRIn(BaseModel) {order_ref*, utr_number*}
class PaymentConfigIn(BaseModel) {upi_id?, upi_name?, bank_account?, bank_ifsc?, bank_name?, admin_whatsapp?}
class ConfirmIn(BaseModel) {notes?}
class RejectIn(BaseModel) {reason*}
class ManualAssignIn(BaseModel) {plan_id*, billing_cycle?, notes?}
def get_org_plan(tenant_id, db: Session) → Plan  # Return the current plan for an org (falls back to free plan)
def get_org_usage(tenant_id, db: Session) → UsageRecord  # Return or create current month's usage record
def check_submission_limit(tenant_id, db: Session)  # Raise 402 if org has hit submission limit
def check_feature(tenant_id, feature: str, db: Session)  # Raise 403 if the org's plan doesn't include the feature
GET /plans  →  list_plans()
POST /request  →  request_payment()
POST /utr  →  submit_utr()
GET /my-subscription  →  my_subscription()
GET /payment-config  →  get_payment_config()
GET /admin/payment-config  →  admin_get_payment_config()
PATCH /admin/payment-config  →  admin_update_payment_config()
GET /admin/requests  →  admin_list_requests()
PATCH /admin/requests/{request_id}/confirm  →  admin_confirm()
PATCH /admin/requests/{request_id}/reject  →  admin_reject()
GET /admin/subscriptions  →  admin_list_subscriptions()
POST /admin/subscriptions/{tenant_id}/assign  →  admin_assign_plan()
DELETE /admin/subscriptions/{tenant_id}  →  admin_cancel_subscription()
```

### backend\app\api\routes\field_govern.py
```
class WaveIn(BaseModel) {questionnaire_id*, wave_number*, wave_label*, panel_key?}
class TabulateRequest(BaseModel) {column_headers*, sample_rows?, user_prompt?, research_type?}
class TabulateExecuteRequest(BaseModel) {groupby_field*, value_field*, aggregation?, form_ids?, chart_type?, title?}
class TabulateCsvRequest(BaseModel) {rows*, groupby_field*, value_field?, aggregation?, chart_type?, title?}
class WriterRequest(BaseModel) {style?, date_range?, custom_context?, tabulation_data?}
class RestoreRequest(BaseModel) {analysis_id*}
class FeedbackRequest(BaseModel) {vote?}
class SmartBuildRequest(BaseModel) {column_ids?, column_headers?, query?}
class PolishRequest(BaseModel) {title*, groupby_field*, value_field?, aggregation?, rows?, is_cross_tab?}
class InterpretRequest(BaseModel) {title*, subtitle?, groupby_field*, value_field?, aggregation?, rows?}
class SaveTabulationRequest(BaseModel) {tabulation*}
class AutoGenerateRequest(BaseModel) {objectives?}
GET /programs/{program_id}/waves  →  get_waves()
PATCH /programs/{program_id}/panel-study  →  toggle_panel_study()
PUT /programs/{program_id}/waves  →  set_wave()
DELETE /programs/{program_id}/waves/{questionnaire_id}  →  clear_wave()
GET /programs/{program_id}/attrition  →  attrition_report()
GET /programs/{program_id}/analyzer-data  →  get_analyzer_data()
GET /programs/{program_id}/summary  →  get_program_summary()
POST /programs/{program_id}/tabulate/suggest  →  suggest_tabulation()
POST /programs/{program_id}/tabulate/smart-build  →  smart_build_tabulation()
POST /programs/{program_id}/tabulate/polish  →  polish_tabulation()
POST /programs/{program_id}/tabulate/interpret  →  interpret_tabulation()
POST /programs/{program_id}/tabulate/execute  →  execute_tabulation()
POST /tabulate-csv  →  tabulate_csv()
GET /programs/{program_id}/analysis  →  get_analysis()
GET /programs/{program_id}/writer-tables  →  get_writer_tables()
GET /programs/{program_id}/analysis/status  →  get_analysis_status()
GET /programs/{program_id}/analysis/history  →  get_analysis_history()
POST /programs/{program_id}/analysis/restore  →  restore_analysis()
```

### backend\app\api\routes\programs.py
```
class LocationIn(BaseModel) {state?, district*, block?, village?, gps_lat?, gps_lng?}
class ProgramIn(BaseModel) {name*, scheme_name?, description?, start_date?, end_date?, status?}
class BulkProgEditSettingRequest(BaseModel) {allow_enumerator_edit?}
class ParticipantTypeIn(BaseModel) {name*, description?, sort_order?}
class QuestionnaireIn(BaseModel) {participant_type_id?, form_id?, name*, total_target?, start_date?, end_date?}
class LocationTargetIn(BaseModel) {location_id*, target_count*, deadline?}
GET /locations  →  list_locations()
POST /locations  →  create_location()
PATCH /locations/{loc_id}  →  update_location()
DELETE /locations/{loc_id}  →  delete_location()
GET /overview  →  progress_overview()
GET /  →  list_programs()
POST /  →  create_program()
GET /{prog_id}  →  get_program()
PATCH /{prog_id}  →  update_program()
PATCH /bulk-edit-setting  →  bulk_update_program_edit_setting()
DELETE /{prog_id}  →  delete_program()
POST /{prog_id}/participant-types  →  create_participant_type()
PATCH /{prog_id}/participant-types/{pt_id}  →  update_participant_type()
DELETE /{prog_id}/participant-types/{pt_id}  →  delete_participant_type()
GET /{prog_id}/questionnaires  →  list_questionnaires()
POST /{prog_id}/questionnaires  →  create_questionnaire()
PATCH /{prog_id}/questionnaires/{q_id}  →  update_questionnaire()
DELETE /{prog_id}/questionnaires/{q_id}  →  delete_questionnaire()
POST /{prog_id}/questionnaires/{q_id}/targets  →  create_location_target()
PATCH /{prog_id}/questionnaires/{q_id}/targets/{t_id}  →  update_location_target()
DELETE /{prog_id}/questionnaires/{q_id}/targets/{t_id}  →  delete_location_target()
GET /{prog_id}/progress  →  get_progress()
GET /{prog_id}/progress/xlsx  →  export_progress_xlsx()
GET /{prog_id}/progress/pdf  →  export_progress_pdf()
```

### backend\app\api\routes\shared_files.py
```
class CreateFolderRequest(BaseModel) {name*}
class RenameRequest(BaseModel) {new_name*}
POST /  →  upload_shared_file()
GET /folders  →  list_folders()
POST /folders  →  create_folder()
GET /  →  list_shared_files()
GET /{file_id}/download  →  download_shared_file()
PATCH /{file_id}/rename  →  rename_shared_file()
GET /{file_id}/csv-data  →  get_csv_data()
PATCH /{file_id}/share  →  update_sharing()
DELETE /{file_id}  →  delete_shared_file()
```

### backend\app\api\routes\user_tool_projects.py
```
class ProjectIn(BaseModel) {tool*, name*, program_id?, data?}
class ShareProjectRequest(BaseModel) {tenant_ids*}
GET /tool-projects/  →  list_projects()
POST /tool-projects/  →  upsert_project()
PATCH /tool-projects/{project_id}/share  →  share_project()
DELETE /tool-projects/{project_id}  →  delete_project()
```

### backend\app\models\shared_file.py
```
class SharedFile(Base)
```

### backend\app\models\user_tool_project.py
```
class UserToolProject(Base)
```

## frontend

### frontend\src\admin\AdminPanel.modern.tsx
```
component PlanBadge
component StatusBadge
component RoleBadge
component GlassCard
component StatCard
component TableHeader
component EmptyState
component AdminPanel
hook useState
hook useMemo
hook useEffect
handler onChange
handler onClick
```

### frontend\src\admin\AdminPayments.tsx
```
component AdminPayments
hook useToast
hook useState
hook useCallback
hook useEffect
handler onClick
handler onChange
```

### frontend\src\components\Sidebar.tsx
```
props SidebarProps
hook useState
hook useNavigate
hook useLocation
hook useHelp
hook useLanguage
hook useTheme
export Sidebar
handler onMouseEnter
handler onMouseLeave
handler onChange
handler onClick
```

### frontend\src\components\TopNav.tsx
```
component NotifRow
component NotificationBell
component UsageBar
props TopNavProps
hook useState
hook useRef
hook useNavigate
hook useTheme
hook useCallback
hook useEffect
hook useSubscription
export TopNav
handler onClick
```

### frontend\src\fg\FileManagerPage.tsx
```
component FileManagerPage
hook useToast
hook useRef
hook useState
hook useEffect
hook useCallback
handler onClick
handler onChange
handler onKeyDown
```

### frontend\src\lib\fgStorage.ts
```
export interface SavedTabulation
  id: string title: string description: s
export interface SavedReport
export async function loadTabulations(programId) → Promise<SavedTabulation[]>
export async function loadWriterTables(programId) → Promise<SavedTabulation[]>
export function loadTabulationsCache(programId) → SavedTabulation[]
export async function saveTabulation(programId, tab) → Promise<void>
export async function deleteTabulation(programId, tabId) → Promise<void>
export function loadReports(programId) → SavedReport[]
export function saveReport(programId, report)
export function deleteReport(programId, reportId)
export async function saveAnalyzerToolProject(programId, programName, tab) → Promise<void>
export function getLastProgram() → string
export function setLastProgram(id)
```

### frontend\src\programs\FgAnalyzer.tsx
```
component StatCard
component OverviewTab
component TabulationCard
component TabulatorTab
component PanelStudyTab
component CsvTab
component ProgramPicker
component FgAnalyzer
hook useToast
hook useState
hook useCallback
hook useEffect
hook useRef
handler onClick
handler onChange
handler onDelete
handler onUpdate
```

### frontend\src\reports\FgWriter.tsx
```
component ProgramPicker
component TabPreview
component MarkdownPreview
component ReportVersionCard
component ScheduleModal
component FgWriter
hook useState
hook useEffect
hook useToast
hook useAiJob
hook useCallback
handler onChange
handler onClick
handler onProgramChange
handler onData
handler onNum
handler onRestore
```
