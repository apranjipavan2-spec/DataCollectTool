# FieldGovern — Task Board

## ✅ Completed (this sprint)

- [x] FG Analyzer page (`/fg/analyzer`) — Overview, Tabulator (AI + manual), Panel Study tabs
- [x] FG Cleaner page (`/fg/cleaner`) — paginated quality table, issue filter cards
- [x] FG Writer page (`/fg/writer`) — program-aware, loads Analyzer tabulations, saves report versions
- [x] `fgStorage.ts` — localStorage helpers for tabulations, reports, last-program sync
- [x] Nav items: FG Analyzer, FG Cleaner, FG Writer added for org_admin + supervisor
- [x] `field_govern.py` registered under `/api/v1/fg` prefix
- [x] AI tabulation: bulk suggest (returns 3-5 tables), per-prompt single suggest, Run All
- [x] Panel Study: toggle, wave assignment (number/label/panel_key), attrition report with lost IDs
- [x] Seed patches added for migrations 0019–0025 in `seed_dev.py`
- [x] `wait_and_stamp.py` detection logic updated to stamp up to 0025
- [x] Public survey URL — backend done, frontend `PublicSurveyPage.tsx` done, share button in Dashboard
- [x] Back-check flagging — `POST /submissions/{id}/flag-backcheck`, filter in Dashboard
- [x] Back-check form assignment — `PATCH /submissions/{id}/backcheck-form`, form selector in detail modal
- [x] Duplicate detection — `GET /submissions/potential-duplicates`, `_duplicate_suspect` flag on sync
- [x] Geofencing — enforced in sync endpoint, violation logged in `data_json`
- [x] Server-side validation rules — `_run_validation()` in sync, violations stored in `data_json`
- [x] Stata `.dta` export — `GET /export/{form_id}/dta`
- [x] SPSS `.sav` export — `GET /export/{form_id}/spss`
- [x] **Repeat Groups** — child field editor in `FieldEditor.tsx`, `RepeatGroupField` renderer in `FieldApp`
- [x] Free plan: 3 users, 100 lifetime submissions (enforcement in `plan_enforcement.py`)
- [x] AI config locked to master_admin only; org_admin sees read-only status

## 🔴 Blocked / Needs External Action

- [ ] Sentry DSN env vars (SENTRY_DSN, VITE_SENTRY_DSN) — see `planning/PENDING_MANUAL.md`
- [ ] Each org needs AI keys set via Org Settings → AI (master_admin assigns)

## 📋 Next Sprint Candidates

### Medium Priority
- [ ] AI form builder assistant (skip logic from plain English)
- [ ] Auto-translate form labels (one-click Hindi/Kannada/Telugu)

### Low Priority
- [ ] DHIS2 push integration
- [ ] Back-check enumerator workflow — enumerator sees back-check queue + opens assigned form

## Review Notes

- FG Analyzer/Cleaner/Writer are program-picker-based (not URL-param), with program selection synced via localStorage across tools
- FG Writer reads saved tabulations from FG Analyzer via `fgStorage.ts` — no extra API needed
- All FG backend endpoints filter by `tenant_id` on every query — tenant isolation confirmed
- CORS: `allow_origins=settings.cors_origins` (configurable via `CORS_ORIGINS` env var), credentials + all methods/headers allowed
- RLS: `set_tenant_context()` called in `deps.py` on every authenticated request
- `IntegrationsPanel.tsx` line 114 has a pre-existing TS syntax error (unrelated to sprint work)
