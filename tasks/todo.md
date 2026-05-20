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

## ✅ Completed (sprint 3)

- [x] Light theme as default (ThemeContext fallback changed from 'dark' → 'light')
- [x] AppLogo component — theme-aware: `mix-blend-mode: multiply` in light (gold lion, white bg disappears), `brightness(0) invert(1)` in dark (white silhouette on dark surface)
- [x] Login page — logo updated: golden lion shows properly, no more gray darkening filter
- [x] Sidebar — actual logo image in header for both desktop and mobile drawers
- [x] Improved field map: form/enumerator filter dropdowns, legend overlay, empty-state hint, stale-closure fix
- [x] Back-check queue: always visible button (not hidden when 0), refresh button, improved task cards
- [x] Background GPS accuracy strip in form collection screen (colour-coded, live update)

## ✅ Completed (sprint 2)

- [x] CSV export with field labels (`?labels=true`) — remaps field IDs → labels, decodes choice values
- [x] Automated outlier detection in FG Cleaner — mean ± 2σ on numeric fields (≥5 data points), shows as "outlier" filter card
- [x] Comments & review thread on submissions — `CommentsThread` in detail modal, backend `comments.py`
- [x] In-app notification inbox — `NotificationBell` in TopNav, 60s polling, unread badge, `inbox.py`
- [x] Live field map (`/map`) — Leaflet CDN, colour-coded pins by status, days filter, click popup
- [x] Usage dashboard — "Usage" tab in SuperAdminMonitor, per-tenant table, platform totals
- [x] Background GPS — `watchPosition` auto-starts on form open, captures best accuracy fix on submit
- [x] Back-check queue — already built in FieldApp (orange badge + screen) — confirmed complete
- [x] Multi-provider AI config — OpenAI / Anthropic / Google simultaneously with active toggle
- [x] 14 demo programs across 7 sectors with realistic Indian data (`seed_programs.py`)
- [x] AI tab hidden from org_admin (master_admin only)
- [x] Import item removed from org_admin sidebar

## ✅ Completed (sprint 4)

- [x] AI form builder assistant — `SkipLogicEditor.tsx` + `suggest_skip_logic()` in `ai_service.py`; AI panel with description input, Generate Rules button, suggestion cards with Apply; endpoint updated to pass `user_description`
- [x] Auto-translate form labels — verified already fully implemented (lines 85–113 `FormBuilder.modern.tsx`), wired to `/ai/translate`
- [x] Enumerator performance scorecard — `GET /submissions/enumerator-scorecard`; `ScorecardTab.tsx` lazy-loaded; SQLAlchemy `case()` aggregations for accuracy_rate, backcheck_pass_rate, submissions_per_day
- [x] Scheduled report delivery — `ScheduledReport` model + migration 0035; `services/scheduled_reports.py`; APScheduler job every hour; `ScheduleModal` in FgWriter; MIME DOCX email attachments
- [x] Analyzer tabulations saved to Files menu — `saveAnalyzerToolProject()` in `fgStorage.ts`; `tabToCsv()` generates CSV; fire-and-forget on every tabulation save in FgAnalyzer.tsx

## 📋 Next Sprint Candidates

### Low Priority
- [ ] DHIS2 push integration
- [ ] ODK Central compatibility layer (import ODK XLS form, export ODK-compatible submissions)

## 🌐 SEO / Marketing site (zero-budget plan)

See `tasks/seo_user_actions.md` for the full FREE-only action plan and `tasks/seo_submissions.md` for pre-written submission copy. Highest-ROI tasks (do this week):

- [ ] GSC verification + sitemap submission + URL inspection for 21 URLs (30 min)
- [ ] GA4 setup + share Measurement ID for wiring (15 min)
- [ ] Bing Webmaster Tools — import from GSC (10 min)
- [ ] Product Hunt scheduled launch — Tuesday/Wednesday (30 min)
- [ ] AlternativeTo submissions across all 8 competitors (15 min)
- [ ] HARO / Qwoted / Featured signup — 60 min/week ongoing
- [ ] G2 + Capterra free vendor profiles (40 min)
- [ ] LinkedIn Company Page + first post (15 min)

Programmatic SEO already shipped (no action needed):
- ✅ 8 competitor comparison pages
- ✅ 5 long-tail topical landing pages
- ✅ Pricing Product+Offer JSON-LD schema
- ✅ Custom 404 + sitemap with 21 URLs
- ✅ Title CTR optimisation on home / features / pricing
- ✅ Lazy-loading on footer images

## Review Notes

- FG Analyzer/Cleaner/Writer are program-picker-based (not URL-param), with program selection synced via localStorage across tools
- FG Writer reads saved tabulations from FG Analyzer via `fgStorage.ts` — no extra API needed
- All FG backend endpoints filter by `tenant_id` on every query — tenant isolation confirmed
- CORS: `allow_origins=settings.cors_origins` (configurable via `CORS_ORIGINS` env var), credentials + all methods/headers allowed
- RLS: `set_tenant_context()` called in `deps.py` on every authenticated request
- `IntegrationsPanel.tsx` line 114 has a pre-existing TS syntax error (unrelated to sprint work)
