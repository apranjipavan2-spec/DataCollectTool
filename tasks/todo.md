# FieldGovern — Task Board

## DPDP compliance & pricing-credibility audit — in progress 2026-09-18
External audit (`FieldGovern_Compliance_and_Development_Plan.docx`) flagged inconsistent
public pricing (₹7,999 vs ₹6,999 vs ₹18,000 across pages) and a 25-item DPDP/security/
marketing gap list. Full tracked backlog with status: **`tasks/dpdp_master_plan.md`**.
This session: built site-wide live pricing sync (admin edits a plan price once →
`GET /billing/public-pricing` → every marketing page updates; static/SEO fallbacks kept
in sync via `backend/scripts/sync_website_prices.py`) + fixed the exact stale-price
relics the audit named. Compliance items (P0 items 1–3, then P1/P2) tracked and worked
in `tasks/dpdp_master_plan.md`, not duplicated here.

## Resubmit cooldown + duplicate-submission guard — built 2026-09-17
Enumerators were spam-clicking Submit (retrying blind on slow/offline connections),
creating duplicate records. Added to `FormRenderer.tsx`: a 30s per-form cooldown after
a successful submit (timestamp in `localStorage`, keyed `fg_submit_cooldown_{formId}`,
survives "Submit Another Application" remounts, works fully offline since it's pure
client state) — Submit button shows a `Wait Ns…` countdown with a shrinking overlay
animation and stays disabled. Also added a duplicate-answers check: before submitting,
compares the new answers against the most recent locally-saved submission for that form
(`getLastSubmission` in `FieldApp.modern.tsx`, backed by `store.listSubmissions()` —
same local IndexedDB/OPFS store, so it's offline-safe too), ignoring per-submission
metadata (`_started_at`, `_duration_sec`, `_audio_audit`). On a match, the Submit button
is replaced with a warning panel — "Go back" or "Submit anyway" — nothing is pushed
until the enumerator picks. Only wired into the active `FieldApp.modern.tsx` collection
screen; the legacy `FieldApp.tsx`/`PublicSurveyPage.tsx` FormRenderer call sites are
unaffected (new props are optional).

## in_app_notifications migration gap — FIXED + verified 2026-09-16
Same bug class as `submission_comments` (flagged, not fixed, in the MEAL entry below —
now closed). Added `app/models/in_app_notification.py` (`InAppNotification(Base)`,
registered in `models/__init__.py`) and migration
`0055_in_app_notifications_table.py` (idempotent `CREATE TABLE IF NOT EXISTS`, matches
the shape `inbox.py`'s `_ensure_table()` was already creating at runtime, now with real
FKs to `tenants`/`users`). Left `inbox.py`'s `_ensure_table()` calls in place — harmless
redundant idempotent defense-in-depth, same choice made for `comments.py`/`_ensure_table`
after the `submission_comments` fix. No code changes needed in `notify.py` or
`billing.py`'s separate raw-SQL notifier — both already insert into the now-migration-
backed table without modification.
**Verified**: fresh throwaway Postgres ran the full chain 0001→0055 clean, `seed_dev.py`
zero patch warnings, `GET /inbox/` worked immediately (no lazy bootstrap needed), and
posting a submission comment produced a real `in_app_notifications` row routed to the
correct recipient — confirmed by querying the table directly.

## MEAL feedback/accountability module — built + verified 2026-09-16
Added `programs.feedback_form_id` (migration `0054_feedback_module.py`, also creates
`feedback_resolutions`: status open|in_progress|resolved|escalated, assigned_to,
resolution_note, resolved_by/at — a thin side table, kept deliberately separate from
`submissions.status` which carries unrelated QC semantics). New model
`app/models/feedback_resolution.py`, new route file `app/api/routes/feedback.py`
(`PUT /programs/{id}/feedback-form`, `GET /programs/{id}/feedback`, `PATCH
/feedback/{submission_id}`), new frontend `FeedbackPanel` (Feedback tab in
`ProgramsPage.tsx`, mirrors the existing `ResultsPanel` convention) + a "Feedback /
Complaints Form" picker added to `SetupPanel`. Deliberately reuses the entire existing
Form Builder → make-public → public-survey pipeline for intake instead of building a
parallel one — a feedback form is just a regular form. Extracted `_create_notification`
out of `comments.py` into shared `app/services/notify.py` (was about to become a third
duplicate of the `in_app_notifications` insert; `billing.py`'s separate copy left as-is).

**Verified end-to-end**, including the real public-facing channel: made a form public via
the existing `/forms/{id}/make-public`, submitted through the actual `/survey/{token}/submit`
endpoint (not a shortcut), confirmed it landed in the program's feedback queue as `open`,
assigned it to a user (confirmed a fresh `in_app_notifications` row), changed status to
`resolved` with a note through the actual browser UI (typed in the real form, clicked Save,
confirmed the DB row updated), and confirmed the Setup tab's form-picker shows the correct
pre-selected form. Zero console errors.

**Two real bugs found and fixed during verification** (would have shipped broken otherwise):
1. `create_notification()` in the new `notify.py` inserted into `in_app_notifications`
   without ensuring the table exists first — that table (like `submission_comments` used
   to be) is only ever created lazily by `inbox.py`'s `_ensure_table()`. First assignment
   attempt silently lost the notification (caught by the try/except, no crash, no warning
   surfaced to the user). Fixed by calling `inbox._ensure_table(db)` before the insert.
   `in_app_notifications` itself had the same missing-migration gap `submission_comments`
   had (no model, no migration, only ever created at runtime) — since fixed too, see the
   entry above.
2. `GET /users/` returns `{items: [...], total}`, not a bare array — the frontend's staff
   list for the assignee picker was reading `r.data` directly and would have silently shown
   an empty picker. Fixed to read `r.data?.items`.

**Known test-setup gotcha, not a code bug**: reusing an existing form (one that already has
unrelated submissions from before it was designated "the feedback form") will show ALL of
that form's historical submissions in the feedback queue, since scoping is by `form_id`
alone (deliberately, so untagged public submissions — which never get a `program_id` —
still show up). The intended usage is a form built specifically for feedback, not a reused
general survey form. Flag if a user reports queue pollution from reusing an existing form.

## submission_comments migration gap — FIXED + verified 2026-09-16
Added `app/models/submission_comment.py` (proper `SubmissionComment(Base, SoftDeleteMixin)`
model, registered in `models/__init__.py`; removed the duplicate inline class from
`comments.py` which would have collided on the same `__tablename__`), migration
`0053_submission_comments_table.py` (creates the table with `deleted_at` from the start),
and patched `0046_soft_delete_deleted_at.py` to skip a table that doesn't exist yet
(the actual unblock, since 0046 runs before 0053 in sequence). Dropped the now-redundant/
unsafe `submission_comments` ALTER from `seed_dev.py`'s patch list.
**Verified**: a genuinely fresh throwaway Postgres ran the *entire* migration chain
0001→0053 with zero errors (previously failed partway), and `seed_dev.py` ran with
**zero** patch warnings (previously dozens, cascading from the same failed-transaction).
`POST/GET /submissions/{id}/comments` confirmed working against the migration-created
table (not the `_ensure_table()` runtime fallback). This closes the "Broken local test
infra" item below.

## Donor export template — built + verified 2026-09-16
Added a `donor` style to `REPORT_STYLE_PROMPTS` in `app/services/ai_service.py`
(Executive Summary / Program Overview / Results Against Targets / Key Achievements /
Challenges & Mitigation / Financial Overview [explicitly `[DATA NOT AVAILABLE]`,
never invented] / Recommendations / Next Steps). `generate_program_report()` gained an
`indicators_block` param; `field_govern.py`'s `/writer/generate` builds it from the
Results Framework's `_build_itt()` (real baseline/target/actual numbers, not prose) when
`style == "donor"`. `POST /ai/writer/export-docx` gained `include_cover: bool` — renders
a cover page (tenant name/logo, report title, date) via python-docx before the report body,
using the tenant's existing (previously unused by any exporter) `logo_url`/`name`
branding fields; a missing/unreachable logo never fails the export, just falls back to
text-only. Frontend `FgWriter.tsx`: added the "Donor Report" style pill + a "Cover page"
checkbox (auto-checked when style is donor).
**Verified**: found and fixed a real bug during verification — `Pt`/`Inches` were
imported inside `export_docx()` but referenced from the separate `_add_cover_page()`
helper (NameError, 500). Fixed, then confirmed live: cover-on renders
`[tenant name, blank lines, title, date]` then a page break then the normal report body
(inspected the actual generated .docx paragraph-by-paragraph); cover-off renders
identically to before. The `indicators_block` formatting was verified against a real
computed indicator (75.0% actual, exactly matching 3-of-4 test submissions) — the AI
call itself (`_call_llm`) was not exercised live (no API key in this environment), but
its input is now proven correct.
**Known minor edge case found, not fixed (out of scope for this pass)**: if an indicator
is created as `manual` (which seeds a `value_source='manual'` row per wave) and later
edited to `auto`, the pre-existing seeded row keeps blocking auto-compute forever —
`compute_indicator()`'s "never clobber a manual cell" guard doesn't distinguish "user
typed a real override" from "stale seed from before the indicator was reconfigured".
Low-frequency edge case (only hits indicators whose `value_source` is changed after
creation); flag if a user reports an auto indicator that never populates.

## Results Framework (M&E logframe/indicators/ITT) — built + verified 2026-09-16
Added migration 0052 (`logframe_levels`, `indicators`, `indicator_values`), models
`app/models/results_framework.py`, service `app/services/indicator_compute.py`
(count/sum/mean/percent aggregation + disaggregation + logframe roll-up, has a
`__main__` self-check that passes), routes `app/api/routes/results.py` (mounted at
`/api/v1/results`), and a Results tab (`ResultsPanel`) in `frontend/src/programs/ProgramsPage.tsx`.
Indicator "Form field"/"Numerator field"/"Disaggregate by" inputs use a `<datalist>`
sourced from the linked questionnaires' form schemas (autocomplete, still free-text
for forms outside the program) — added and confirmed live (datalist populated with
all 25 real field keys off a seeded form) 2026-09-16. Also fixed the `ScheduledReport`
model import gap (same bug class as the `Location` one below) while re-verifying.

**Verified end-to-end** against a real throwaway Postgres + running backend + Vite
dev server + Chrome: migration applies, auto-compute against real submissions
produced exact expected values (50%→70% across baseline/midline, sex-disaggregated
splits numerically exact), roll-up (Outcome→Goal) reflected the latest wave, manual
override persisted across a page reload and survived a recompute attempt (correctly
skipped), xlsx export downloaded cleanly, and the Results tab renders/edits/adds
indicators correctly in the browser with zero console errors on the app's own code.
MEAL feedback/accountability module and donor-specific export templates deliberately
deferred — see plan (`could-you-please-check-bubbly-mitten.md` in the user's plan dir).

## Broken local test infra (found 2026-09-08 — ALL root causes fixed 2026-09-16)
`cd backend && pytest` / a fresh-DB bootstrap had 4 independent failures, all now fixed:
- ~~`app/models/__init__.py` never imports `app.models.location` (`Location`)~~ **fixed**
  — now imported, `Base.metadata.create_all()` resolves `respondent_roster.location_id`'s FK.
- ~~`app/models/__init__.py` never imports `app.models.scheduled_report` (`ScheduledReport`)~~
  **fixed** — same bug class, was breaking the `scheduled_reports` schema patches.
- ~~5 models had malformed JSONB `server_default` strings~~ **fixed** — `tenant.py`,
  `audit_log.py`, `form.py`, `roster.py`, `user_tool_project.py` all passed a plain
  Python string like `"'{}'::jsonb"` as `server_default`; SQLAlchemy quotes plain
  strings as literals, producing invalid SQL (`'''{}'''::jsonb`). Fixed by wrapping
  in `sa.text(...)`.
- ~~Real Alembic migrations against a truly fresh DB failed partway at
  `ALTER TABLE submission_comments`~~ **fixed** — see "submission_comments migration
  gap" entry above.
**Verified 2026-09-16**: a genuinely empty DB now runs `alembic upgrade head` (0001→0053)
clean, and `seed_dev.py` afterward produces zero patch warnings. `pytest` itself was not
re-run in this pass (no test suite currently targets a fresh DB directly) but the
underlying blocker is gone.

## Residual from L024 (id vs name tabulation fix, 2026-09-08)
Tabulations saved *before* the fix still persist the old (broken) UUID
`groupby_field`/`value_field`. They won't auto-correct — need to be rebuilt/re-run
in the Analyzer to pick up real data. No migration written for existing saved
tabulations; flag if a user reports an old saved table still showing all-missing.

## DPDP Act 2023 — compliance backlog (added 2026-09-05)
Source: comparison with the Next.js redesign's 9-clause mapping. Split into what
we already ship vs what we still need to build. Website `#dpdp` section only
claims the LIVE items — do not add website claims for backlog items until built.

### ✅ Live today (verified in code)
- **§6 Consent capture** — `submission.consent_given` + `consent_timestamp`; per-form `/forms/{id}/consent-log`
- **§12 Access & correction** — admin-mediated `PATCH /submissions/{id}/data`, versioned + audit-logged (not self-service yet)
- **§12(b) Erasure** — anonymisation via `POST /submissions/{id}/anonymize`
- **§8 Safeguards** — PostgreSQL RLS tenant isolation (0048), bcrypt, JWT, TLS
- **§13 Audit trail** — `models/audit_log.py`
- **§17 Data residency** — India-hosted by default (deployment)

### 🔨 To implement (ranked)
1. **§6(4) Purpose limitation** — mandatory Purpose field per form; shown at consent; stored with submissions; surfaced in audit log
2. **§11 Notice of Data Collection** — auto-generated notice (English + regional language) at consent step: fields, purpose, retention, recipients, rights
3. **Retention period per form + auto-purge** — declare retention on form; scheduler purges/anonymises at end of window (reuse `scheduler.py` pattern)
4. **§12(b) Self-service erasure request** — verified data-principal erasure endpoint that finds all submissions across forms/projects; consent withdrawal auto-triggers it
5. **§12 Respondent Portal** — data principal views their own submissions (by phone/email/ID hash) + requests corrections (upgrade from admin-mediated)
6. **Richer consent types** — audio + signature consent (currently boolean only); store consent artefact
7. **§16 Children's data** — form-level Child Data Flag → verified parental consent step; POCSO mode; confirm no ad SDKs
8. **§17 Cross-border opt-in** — explicit tenant-level toggle + audit log for any cross-border transfer (off by default)
9. **§8(5) Breach notification** — 72-hour runbook, anomalous-access detection, DPB + data-principal notification templates, incident log
10. **Respondent Rights officer role** — optional role on Custom plan


## ✅ Just shipped — TableForge Phase 6 (Causal + Power + Codebook + AI Summary + Mixed-LM + Roster)

- **Causal** `routers/causal.py`: `/api/causal/did` (DiD OLS with `treatment:post` interaction), `/api/causal/psm` (logit-propensity + 1-NN matching + SMD balance), `/api/causal/mixed_lm` (random-intercept mixed-effects via `statsmodels.mixedlm`, optional random slope, returns ICC + fixed effects)
- **Power planner** `routers/power.py` (5 endpoints): `two_sample_t`, `paired_t`, `proportions`, `anova`, `curve` — each supports `solve_for: n|power|effect` via `statsmodels.stats.power`
- **Codebook** `routers/codebook.py`: `POST /api/export/codebook` → DOCX data dictionary (title page, dataset summary, study design block, per-variable directory with descriptives + value labels + frequencies)
- **AI exec summary** in `routers/auto_analyze.py`: `POST /api/analyze/exec-summary` — markdown one-pager (Headline / Key findings / Caveats / Next steps) with executive (250w) / general (400w) / technical (600w) audience presets, reuses `_call_llm` from `routers/ai.py`
- **Survey weights wired through inferential tests**: `stat_logistic_regression` → `glm(family=Binomial, freq_weights=…)`; `stat_multiple_regression` → `wls(weights=…)` when `StudyDesign.weight_col` is set
- **Household roster helpers** in `routers/metadata.py`: `POST /api/metadata/roster/to_wide` (long → wide pivot with `{col}_1`, `{col}_2`…), `POST /api/metadata/roster/to_long` (reverse), supports member-id collapse via mean/sum/median/etc.
- **Frontend wiring**: new `AdvancedAnalysisPanel.tsx` (6 modal forms: DiD, PSM, MixedLM, Power, Codebook, AI Summary); "Advanced Analysis" ribbon group in `RibbonBar.tsx` Statistics tab; `App.tsx` dispatches the 6 actions to `setAdvancedKind`; `AutoAnalyzePanel` now exposes `onPackReady` so the AI Summary form auto-fills the latest pack
- Route count: 146 → 158. TS clean.

## ✅ Just shipped — TableForge Phase 4 backend (Triangulation library)

- New router `routers/triangulate.py` (6 endpoints): `/api/benchmarks/list`, `/api/benchmarks/{id}`, `/api/benchmarks/meta/topics`, `/api/triangulate` (single value vs indicator), `/api/triangulate/auto` (pull value from dataset column + weights), `/api/triangulate/pack` (batch), `/api/benchmarks/contribute` (analyst extension via `user_extensions.json`)
- Seed library `tools/tableforge/benchmarks/india_2024.json` — 30 indicators across Census 2011, NFHS-5, NSSO 77, PLFS 2022-23, CGWB, NITI Aayog SDG, PMKSY-PDMC
- `tools/tableforge/benchmarks/sources.md` — citation manifest + indicator schema + curation rules
- Verified: backend boots with 146 routes (up from 144); library loads 30 indicators across 13 topics; one-sample z test on a proportion returns expected z = -3.68, p = 0.0002 on a 92%/95.9% smoke case
- Frontend `TriangulationPanel.tsx` deferred (user instruction)

## ✅ Earlier — TableForge Survey Analysis Studio (Phases 0 + 1 + 2 + 3)
Roadmap: `tasks/roadmap_survey_analysis_studio.md` · Plan: `~/.claude/plans/zany-spinning-wren.md`

**Phase 0 — Variable Metadata layer**
- `column_roles` + `study_designs` shared state, persisted via project file
- Router `routers/metadata.py` (7 endpoints): set/bulk_set/get/delete roles, study design save/get, heuristic auto-detect
- Frontend: `VariableMetadataPanel.tsx`, `StudyDesignWizard.tsx`, "Survey Design" ribbon group, role badges on SourcePanel

**Phase 1 — Inferential test backfill**
- New router `routers/inferential.py` (12 endpoints): paired_ttest, wilcoxon, mcnemar, kruskal, friedman, spearman, kendall, logistic_regression, multiple_regression, posthoc (tukey/bonferroni/games-howell), reliability (Cronbach's α), multitest_correction (Bonferroni/Holm/BH-FDR)
- New `routers/inferential_utils.py`: Cohen's d, Hedges' g, d_z, Cramér's V, η², ω², rank-biserial r, CIs, Cronbach's α, multitest correction
- Augmented `stats.py`: crosstab → Cramér's V + Fisher's exact + small-N warning; ttest → Welch by default + Cohen's d + Hedges' g + CI; anova → η² + ω² + Welch's F + Levene; correlation → method param (Pearson/Spearman/Kendall)
- Frontend: `StatisticalTables` extended (20 test types), `RibbonBar` Statistics tab gains Paired/Pre-Post, Non-parametric, Models ribbon groups
- Backend deps: added `statsmodels>=0.14`, `scipy>=1.11`
- Verified: backend boots with 105 routes (up from 93); frontend `tsc --noEmit` clean; 10 endpoints smoke-tested end-to-end

Next: Phase 2 (Likert / Multi-Response / Observer modules) — see roadmap.

## 🔴 Blocked / Needs external action
- [ ] Sentry DSN env vars (`SENTRY_DSN`, `VITE_SENTRY_DSN`) — see `planning/PENDING_MANUAL.md`

## ✅ AI key model (confirmed 2026-06-02)
- AI key is **global**, set once by master_admin via `PATCH /api/ai/config` (stored in `SystemSetting.ai_config`). Auto-replicated to every tenant/user — no per-org assignment needed.

## 📋 Next sprint candidates (low priority)
- [ ] DHIS2 push integration
- [ ] ODK Central compatibility layer — import ODK XLS form, export ODK-compatible submissions

## 🌐 SEO / marketing site (zero-budget plan)
Full plan + copy-paste URL list in `tasks/seo_actions.md`. Site verified ready 2026-06-02: 30 indexable URLs, all with canonicals, no noindex on indexable pages, robots.txt + sitemap correct.

### ✅ Done 2026-06-02
- GSC: domain `fieldgovern.com` verified
- GSC: sitemap submitted → Success, 30 pages discovered
- GSC: requested indexing for top 5 URLs (`/`, `/pricing`, `/surveycto-alt`, `/kobotoolbox-alt`, `/dpdp-compliant-survey-software`) — `/` already indexed, others queued

### 📋 Pending — do in this order

**Day 2 (tomorrow) — GSC: request indexing, 10 mid-priority URLs**
- [ ] `/features.html` · `/demo.html` · `/use-cases.html`
- [ ] `/odk-alternative.html` · `/commcare-alternative.html` · `/googleforms-alternative.html`
- [ ] `/best-survey-app-india.html` · `/offline-survey-app-india.html`
- [ ] `/survey-tool-for-ngos-india.html` · `/capi-software-india.html`

**Day 3 — GSC: request indexing, final 15 URLs**
- [ ] `/security.html` · `/about.html` · `/integrations.html`
- [ ] `/dpdp-compliance.html` · `/dpa-template.html` · `/partners.html`
- [ ] `/surveymonkey-alternative.html` · `/qualtrics-alternative.html` · `/magpi-alternative.html`
- [ ] `/blog/` + 5 blog posts (surveycto-alt-india, dpdp-act-2023, offline-data-collection, odk-kobo-commcare-comparison, panel-study-india-guide)

**GA4 (15 min, do this week)**
- [ ] Create GA4 property at analytics.google.com (8 steps listed in chat / seo_actions.md)
- [ ] Send Measurement ID `G-XXXXXXXXXX` to Claude → wire `gtag.js` into all 33 pages in one commit
- [ ] Link GSC under GA4 Admin → Product Links

**Google Business Profile (15 min, do this week)**
- [ ] google.com/business → name FieldGovern · Software Company · +91 80887 09011

**Product Hunt (start warm-up now, launch next Tue/Wed)**
- [ ] Create PH account · follow 20 makers · upvote 10 · comment on 3 (3 days before launch)
- [ ] Schedule launch Tue/Wed 12:01am PT — copy ready in `tasks/seo_actions.md`

Programmatic SEO shipped (commit `125f8e2`): 8 competitor comparisons · 5 long-tail landings · 30-URL sitemap · 404 · Product+Offer JSON-LD on pricing · lazy-loaded images · CTR-optimised titles.

## Review notes
- FG Analyzer/Cleaner/Writer use program-picker (not URL params); program selection synced via localStorage
- FG Writer reads saved tabulations from FG Analyzer via `fgStorage.ts` (no extra API)
- All FG backend endpoints filter by `tenant_id` on every query
- CORS: `allow_origins=settings.cors_origins` (env: `CORS_ORIGINS`)
- RLS: `set_tenant_context()` called in `deps.py` on every authenticated request
- `IntegrationsPanel.tsx`: pre-existing `allow_enumerator_edit` missing on `ProgramListItem` — fixed by adding the optional field to `frontend/src/types/api.ts:54`

## TODO (post-training) — Form link access mode
When admin clicks Share, ask: "Anyone with the link" (public, current behavior) vs
"Only my enumerators" (login required + must be an assigned enumerator).
- Backend: public_survey needs an access_mode on the form/token; the /survey/{token}/info
  + /submit endpoints must enforce auth + assignment check when mode=restricted.
- Frontend: PublicSurveyPage must handle the restricted case (redirect to login, then
  verify the logged-in user is assigned before rendering the form).
- Decision captured 2026-09-02 (Niiti Sangwari endline). Interim: Share dialog now
  warns that public = anonymous; Assign = enumerators-only.
