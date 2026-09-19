# DPDP Compliance & Development Master Plan — Tracked Backlog

Source: `FieldGovern_Compliance_and_Development_Plan.docx` (external audit, 18 Sep 2026).
Full doc scope: India-platform market comparison, DPDP Act 2023 / Rules 2025 gap analysis,
FieldGovern-specific findings, and a phased roadmap to 13 May 2027 (when core DPDP
obligations fully apply).

**Status legend:** `todo` · `in-progress` · `done` · `verified`
Work top-down: P0 → P1 → P1/P2 → P2. Each session resumes at the first non-`verified` item.
When an item lands: tick status here, note what was verified, and add a line to
`tasks/lessons.md` if a bug/lesson emerged (per `CLAUDE.md` workflow rule).

---

## P0 — fix within 30 days (active risk or misstatement)

### 1. AI cross-border data flow — `verified` ✅ 2026-09-18
- [x] **PII stripping before model calls — done + verified 2026-09-18.** New shared
      redaction module at every layer that talks to a third-party LLM:
      `backend/app/services/pii_redact.py` (main app — schema-driven via
      `Form.json_schema`'s `is_identifier` flag + regex heuristic for
      email/phone/Aadhaar-shaped/GPS-pair values in untagged fields),
      `tools/tableforge/backend/pii_redact.py` and `tools/datacleaner/pii_redact.py`
      (heuristic + column-name-hint only, since sidecar tools operate on arbitrary
      uploaded datasets with no form schema). Wired into every raw-data-to-prompt
      call site found in the codebase audit (2 in the main app, 8 in TableForge, 1 in
      DataCleaner). Self-check tests in all three locations
      (`backend/tests/test_pii_redact.py` + two `test_pii_redact.py` alongside the
      tool modules) — caught and fixed two real regex bugs (word-boundary miss on
      snake_case column names, camelCase split-after-lowercase ordering bug) before
      shipping. Full backend test suite re-run clean (9 passed, 0 failed).
- [x] **Go further than redaction for features that don't need real data at all —
      done + verified 2026-09-18.** User asked whether report-writing and
      table-design suggestion could send only column metadata + dummy values
      instead of real (even redacted) content. Answer was yes for those two;
      no for data-cleaning suggestions (their whole job is seeing real values).
      Shipped:
      - New `ai_sanitize.py` in all 3 services (main app, TableForge, DataCleaner
        n/a — no tabulation feature there): type-matched dummy values + a
        population-level aggregate summarizer (`summarize_fields`: value counts /
        numeric min-max-mean / answered-counts only, never a raw row).
      - `generate_report` now sends **zero raw submissions** — only the aggregate
        summary. `suggest_tabulation`/`smart_build_tabulation`/auto-generate flows
        (main app + TableForge, 8 more call sites) now send **zero real
        respondent/dataset values** — fully synthetic rows built from declared
        field type + schema options. `smart_build_tabulation` also dropped a
        500-row DB query entirely (wasn't needed once nothing real is sent).
      - Partial exception for TableForge (uploaded spreadsheets have no separate
        form-schema layer): a non-PII-named, low-cardinality column with repeated
        values (a genuine taxonomy, e.g. "North"/"South") may still send its real
        category labels — never a PII-named column, never free text/numeric.
      - `ai_correct` (DataCleaner) and `create-column` (TableForge) — per explicit
        decision, kept on real values (the feature needs them) but changed from
        silent `[REDACTED]` substitution to a hard 400 refusal naming the PII
        column when one is selected, instead of silently returning a useless
        response.
      - Self-checks in all new modules caught 3 more real bugs before shipping:
        a cardinality-only categorical heuristic that broke on small samples (no
        "repeats required" check), a `dummy_row` calling `dummy_value` with the
        wrong vocabulary (normalized type label vs raw pandas dtype string), and
        a relative-import test-invocation issue. Full backend suite re-run clean
        (17 passed, 0 failed) after every change.
- [x] **AI opt-in per organisation — done + verified 2026-09-18.** Repurposed the
      already-existing-but-unused `Tenant.ai_config` JSONB column (no migration
      needed). Default **on** for every org (existing and new) — a genuine business
      decision, made explicitly with the user: default-off would have silently
      broken AI features for every current paying customer with zero warning.
      Enforced inside `check_feature()` (the single existing choke point all 10
      AI-route call sites already funnel through) so every `ai_*` feature respects
      it regardless of plan tier. `GET/PATCH /tenants/ai-config` (org_admin only,
      same pattern as the existing `/tenants/security` toggle) + a UI card in
      `OrgAdminPanel.modern.tsx`. Standalone-verified (4 scenarios: no config set
      → allowed, explicit true → allowed, explicit false → blocked 403, non-`ai_`
      feature ignores the toggle) since no test DB was available here to run the
      full `backend/tests/test_ai_opt_out.py` suite.
- [x] **Sub-processor list — done + verified 2026-09-18.** Didn't hardcode a
      provider — the admin can configure any of 4 (OpenAI/Anthropic/Gemini/
      DeepSeek) at runtime and this session had no visibility into prod's actual
      DB state. New public no-auth `GET /ai/sub-processor` reads the live
      `system_settings.ai_config` (same resolution logic `GET /ai/config` already
      uses) and returns only `{configured, provider, country}` — never key
      material. Wired into a new "Sub-processors" section on
      `website/dpdp-compliance.html` via a small live-fetch script (same pattern
      as `pricing-sync.js`) — updates automatically if the admin changes provider,
      never needs a manual content edit.
- [x] **BYO (bring-your-own) AI key per org — done + verified 2026-09-18.**
      User asked whether an org could set its own key instead of using the
      shared platform one; confirmed the business model first (org brings AND
      pays for their own key, billed directly by their provider). Built:
      `backend/app/core/tenant_ai_crypto.py` (Fernet, keyed via HKDF off the
      already-required `JWT_SECRET` — no new env var), `backend/app/services/
      tenant_ai_key.py` (resolution: BYO key if enabled+configured → else `{}`
      so callers fall back to the platform key → but raises
      `TenantByoMisconfigured` if BYO is ON but broken, so a half-configured
      org can never silently rack up platform-paid usage while believing
      they're on their own billing). Wired into both `_logged_cfg` choke
      points (`ai.py`, `field_govern.py`) covering all 10 AI-route call
      sites. `GET/PATCH /tenants/ai-config` extended with `byo_enabled/
      byo_provider/byo_model/byo_api_key` (org_admin only; the key is never
      returned once stored, only whether one exists). UI: provider picker +
      key input added to the existing AI Features card in
      `OrgAdminPanel.modern.tsx`.
      **Caught and fixed one real bug during review**, before it shipped: a
      pre-check in `field_govern.py`'s program-report background-job route
      only checked the platform config, so a tenant with a fully valid BYO
      key would have been wrongly told "AI not configured" before their job
      ever got a chance to use it. Fixed to resolve BYO first, same as every
      other call site.
      9 standalone unit tests (`backend/tests/test_tenant_ai_key.py`) cover
      every resolution branch without needing a DB — all pass. Full backend
      suite re-run clean (26 passed, up from 17). Frontend type-checks clean.
- [x] **Corrected the exact overclaim the audit named — done 2026-09-18.**
      `website/index.html:1143` said "Personal data does not leave the deployment
      region unless an organisation explicitly opts in" — false, since no per-org
      opt-in toggle exists yet (see sub-item above). Reworded to state what's
      actually true now (direct identifiers stripped before any AI call) and
      flagged the opt-in as roadmap, not shipped. Checked `dpdp-compliance.html`
      (the dedicated DPDP page) for the same pattern — clean, no AI-specific claims
      there to fix.

### 2. Tenant isolation — `verified` ✅ 2026-09-18
Native PostgreSQL RLS (PR #13, migration 0048) is now **live in production**.
Completed together, live, over SSH: generated a fresh password, set it directly on
the `fieldgovern_app` Postgres role (`ALTER ROLE ... PASSWORD ...` — the step the
original runbook undersold; migration 0048 only sets this password if
`APP_DB_PASSWORD` was present in the environment at the moment it ran, which it
wasn't), added `APP_DB_PASSWORD` to `.env`, restarted the app container. Stayed up
clean, no crash-loop. Smoke-tested: normal user sees only their own org's data ✅,
master_admin still lists every tenant ✅ (public-survey-submission check was
skipped by choice). Full detail in `tasks/pending_owner_action.md` §1.

**Found in the same session, not yet resolved:** the server's region is confirmed
**EU**, not India — contradicts DPDP data-localisation expectations and existing
"India-hosted" marketing claims. Tracked as its own item in
`tasks/pending_owner_action.md` §3.

### 3. Public repository hygiene — `in-progress`
- [x] **Found + rotated a live exposed credential — done 2026-09-18.** Investigating
      this item surfaced `backend/scripts/seed_dev.py:270-271,521` — a hardcoded
      `master_admin` (highest-privilege role) password (`superadmin@4991`) for
      phone `+918317390926`, checked into the public repo. Script runs on every
      deploy per its own docstring and force-resets the password on every actual
      run (not just first-seed). **Confirmed live on production — owner rotated
      the password via Profile → Security → Change Password.** No git-history
      scrub or code fix yet — the exposed value is still in every past commit
      and `seed_dev.py`/`create_superuser.py`/`reset_passwords.py` still contain
      hardcoded credential patterns.
- [x] **Fixed the `users.py:129` weak shared default — done 2026-09-18.** A
      full repo-wide sweep for other hardcoded credentials (API keys, DB
      URLs, connection strings, .env files) found only this one real issue:
      `POST /users/bulk-import` gave every CSV row without an explicit
      password the same hardcoded, publicly-documented value
      (`"fieldgovern123"`) — one leaked/known password compromised every
      such user across every tenant. Fixed: each row without a CSV password
      now gets its own random 12-char password (`secrets.choice`, not
      hardcoded); the admin sees the generated phone/name/password list
      once in the import-result UI (`Dashboard.modern.tsx`) with a
      copy-all button, since it can't be shown again after hashing. New
      `backend/tests/test_bulk_import.py` (3 cases) — collects/skips
      cleanly (no test DB here) but the core new logic (password generator
      itself) was verified standalone: 1000 generated passwords, zero
      collisions, old default absent. Full backend suite re-run clean
      (17 passed). Everything else in the sweep (API keys, JWT secrets, DB
      connection strings, Docker Compose files, `.env.example` templates,
      Alembic migrations, TableForge/DataCleaner) checked clean — either
      properly templated/env-driven or the known intentional demo accounts.
- [x] **Removed the real account from both scripts — done 2026-09-18.**
      `seed_dev.py` and `reset_passwords.py` both had `+918317390926` /
      `superadmin@4991` hardcoded as a seed target. Root fix: a demo-seed
      script should never own or reset a real person's credential at all —
      removed the account from both scripts entirely (not just changed the
      password, which would've just created a new exposed value). That
      account's password now lives only in the database. `seed_dev.py` had a
      `Demo Org`-exists fast-path gate that made this low-risk to deploy as
      one-off; `reset_passwords.py` had **no gate at all** — it's a manual
      "run this if login breaks" ops script, more dangerous of the two.
      Verified: `grep -r superadmin@4991` across the repo now only matches
      this tracking note, not code. Both scripts still syntax-check clean.
- [x] **Git history scrubbed — done 2026-09-18.** User chose the more drastic
      of two offered options (squash all history into one commit, over a
      surgical per-commit secret removal). Verified: `git log --oneline` is
      now 10 commits total, rooted at `db031b8` ("Squash history — remove
      exposed credential from all past commits"). A local-only safety-net
      branch (`pre-squash-backup-2026-09-18`) was kept, never pushed — worth
      deciding whether to delete it now that the squash has been live and
      stable for a while.
- [x] **Licence added — done 2026-09-18.** New `LICENSE` file (proprietary,
      All Rights Reserved) — appropriate since this is a commercial product,
      not open source; an MIT/Apache licence would have wrongly granted
      broad reuse rights. Left the exact legal-entity contact line as a
      placeholder rather than fabricate one.
- [x] **Repo stays public — explicit owner decision 2026-09-18, with real
      infra learning along the way.** Attempted making the repo private.
      Found and fixed one real risk first: the marketing site's GitHub
      Pages deployment was classic branch-based (`docs/` on `main`), which
      needs a paid GitHub plan once private — migrated it to Actions-based
      deployment (`actions/deploy-pages`) and verified the live site first.
      **That still wasn't enough** — flipping the repo private killed Pages
      outright regardless of deployment method; Pages itself needs a paid
      plan for a private repo on this account, full stop. Caught within
      under 2 minutes (the live site returned 404), reverted to public,
      re-created the Pages site, restored the custom domain (`cname` had
      been cleared), and redeployed — verified `www.fieldgovern.com`,
      `pricing.html`, and the app backend `/health` all back to 200 before
      reporting. Given the choice (upgrade to GitHub Pro, move the
      marketing site off Pages entirely, or stay public), owner chose to
      stay public for now. The Actions-based Pages migration itself is a
      genuine improvement kept regardless — it's the correct, modern setup
      and removes ambiguity for whenever privacy is revisited.
      Removing/rotating other seed-script credential patterns from the
      public branch (separate from the licence/privacy decision above) —
      not yet done, real follow-up.
- [x] **App refuses to start on default JWT secret or open/unset CORS in what
      looks like production — done + verified 2026-09-18.** No existing
      `ENVIRONMENT` variable to key off, and adding one that prod's real `.env`
      doesn't set would make the guard silently never fire — instead used a
      signal that must already be correct in prod: `APP_URL` (required, used in
      email links) is only ever `http://localhost:...` by default; any other
      value is treated as "this is a real deployment." Guard lives in
      `main.py`, before `app = FastAPI(...)` is even constructed. Verified all 4
      cases directly (local-dev-nothing-set → passes; prod-looking + placeholder
      JWT_SECRET → blocks; prod-looking + wildcard CORS → blocks; prod-looking +
      real config → passes) via subprocess-isolated env vars, not mocks — see
      `backend/tests/test_prod_config_guard.py`. **Flagged to the user:** if
      prod's real `JWT_SECRET` somehow still is the placeholder (no way to check
      from here), this guard will correctly block the *next* deploy until fixed
      — very unlikely given the live app clearly works today, but worth knowing
      before the next push.

### 4. Marketing accuracy — `in-progress`
- [x] Single canonical price list (₹0 / ₹7,999 / ₹12,999 / ₹24,999) — live-synced across
      the marketing site this session (see `tasks/todo.md` pricing-sync entry).
- [x] Fixed the exact ₹18,000/₹6,999 relics the audit named: `README.md`,
      `SETUP_STATUS.txt`, `FIELDPULSE_GUIDE.html`, `fieldgovern-on-dataworx.html`.
- [x] **Removed the self-scored 9.6/10 ranking — done 2026-09-18.**
      `website/compare.html`'s "Overall ranking" table gave FieldGovern and 8
      competitors fake-precision numeric scores (9.6, 9.0, 8.3...) with no stated
      methodology — exactly what the audit named. Removed all 9 numeric scores,
      kept the ordered ranking + qualitative "best for" reasoning (legitimate
      editorial content), and replaced the closing note with an explicit
      disclosure that this is FieldGovern's own comparison, not a third-party or
      audited score.
- [x] **Swept the clearest "DPDP-compliant" overclaims — done 2026-09-18, partial
      by design.** Fixed ~15 instances across `index.html`, `pricing.html`,
      `security.html`, `features.html` (a hard "DPDP 2023 Compliant" badge),
      `commcare-alternative.html`, `kobotoolbox-alternative.html`,
      `surveycto-alternative.html`, `odk-alternative.html`,
      `survey-tool-for-ngos-india.html` — meta/og/twitter/schema descriptions,
      one UI badge, and every FAQ answer that said an unqualified "Yes" to "is
      FieldGovern DPDP compliant" (now: DPDP-aligned by design, compliance
      depends on customer configuration, legal team should confirm). Two of
      those FAQ fixes also quietly dropped **"tenant isolation" and "encryption
      at rest"** as flat claims — neither is true yet (RLS built but not active
      in prod per item 2; no disk/media encryption per item 10) — so those two
      answers were doubly wrong, not just overclaiming the compliance label.
      **Deliberately NOT touched, ~25 more instances found:** (a) blog posts
      (`dpdp-act-2023-field-research.html`, `dpdp-consent-retention-checklist.html`,
      `panel-study-india-guide.html`) use "DPDP-compliant consent screen/form" as
      *educational guidance to the reader about their own forms* — not a
      self-claim about FieldGovern; (b) the page `dpdp-compliant-survey-software.html`
      and every link/nav-text pointing to it — its URL, `<title>`, and `<h1>` use
      the phrase as a keyword-targeted category name; renaming that URL is an SEO
      decision, not a wording fix, and out of scope here; (c)
      `survey-tool-for-ngos-india.html:298` and `use-cases.html`'s two instances —
      describe what donors/use-cases require as a category, not a FieldGovern
      self-claim. Full list is reproducible: `grep -in "DPDP.compliant" website/**/*.html`.
- [x] **Fixed tenant-isolation wording where found this pass** — see the two FAQ
      answers above.
- [x] **`dpdp-compliance.html`'s compliance-mapping table revisited — done
      2026-09-18, exactly as the deferred decision anticipated.** The two
      rows flagged back on 2026-09-18 ("Implemented" for tenant isolation
      and children's-data guardian consent, neither true at the time) are
      now **actually true** — item 2 (RLS) went live and item 13 (guardian
      consent) shipped later the same day. Kept the "Implemented" pill on
      both (correct now) and rewrote the description text on each row to
      describe the real, built mechanism rather than the vague pre-existing
      copy: S.9 now says date-of-birth auto-detection + linked guardian
      consent + hidden-from-default-view enforcement (matching
      `child_protection.py`); S.8(4) now says database-level RLS via a
      restricted non-superuser role (matching migration 0048) instead of
      the generic "row-level tenant isolation" phrase, plus mentions the
      tamper-evident hash-chained audit log (item 11) that didn't exist
      when this copy was first written. Scoped to exactly these 2 rows per
      explicit instruction — the table's other rows (consent withdrawal,
      breach notification, etc.) weren't touched even though some of them
      also became more true this session (items 7, 12), since that wasn't
      what was asked.

---

## P1 — before 13 May 2027 (DPDP core obligations)

### 5. Notice builder — `in-progress` (core built + verified)
- [x] **Itemised, versioned notice shown before the first question — done
      2026-09-18.** Found a real, already-existing (but cosmetic-only)
      mechanism to build on: `schema.settings.purpose` + `FormRenderer`'s
      consent gate already blocked the first question behind an "I Agree"
      screen — but it only carried one free-text string, was never versioned,
      and **the fact that consent was given was never sent to or stored by
      the backend at all** (`consentTimestamp` lived only in the browser's
      in-memory draft). Extended it rather than rebuilding: `schema.settings`
      gets a new `consent_notice` object (org name, itemised data-collection
      list, purpose, retention, sharing, withdrawal instructions, grievance
      contact, Data Protection Board contact, optional audio-URL) — reuses
      the existing `json_schema` JSONB column, so **no new Form-table
      migration was needed**. Version numbers are **server-assigned**, in
      `forms.py`'s new `_reconcile_consent_notice_version()`: bumps only
      when the notice's own content changes (not on every unrelated
      question edit), and a client-supplied version number is always
      ignored/overwritten — can't be forged. 6 pure-logic pytest cases in
      `backend/tests/test_consent_notice.py` cover first-save, unrelated-edit
      no-bump, content-change bump, and forged-version rejection — all pass.
- [x] **Consent proof now actually reaches the backend — done 2026-09-18.**
      `FormRenderer.tsx`'s `buildFinalDraft()` now stamps
      `_consent_notice_version` / `_consent_language` / `_consent_given_at`
      into `data_json`, riding the exact same established convention as
      `_started_at`/`_duration_sec`/`_audio_audit` (submission-level
      metadata inside `data_json`, already excluded from AI-facing field
      summaries via `field_govern.py`'s `_internal` set, which was extended
      to cover the 3 new keys too). Surfaced in `_sub_summary()`
      (`submissions.py`, the single shared helper every submission-list
      response uses) and added to the existing-but-previously-unused
      `GET /forms/{id}/consent-log` endpoint.
- [x] **Language support: reused, not invented.** The app supports 4
      languages today (`en`/`hi`/`kn`/`te` — `LANGUAGE_OPTIONS`). The notice
      editor (new "Full DPDP Notice" panel in `FormBuilder.modern.tsx`,
      collapsible, next to the existing purpose textarea) and the respondent-
      facing notice screen both reuse the **exact same** nested
      `languages: {code: {...}}` map + `getLocalizedLabel()` fallback
      pattern already used for per-field label/hint translations — zero new
      localization code, a language switcher inside the consent screen
      itself (needed since the main header's language toggle isn't shown
      until after the gate).
- [x] **Verified:** `npx tsc --noEmit --skipLibCheck` clean; `npm run build`
      (production Vite build, including the service worker) succeeds clean.
      Backend: `py_compile` clean on all touched files; full pytest suite
      39 passed / 76 skipped / 0 failed (up from 33 passed before this item).
      **Not done: a live browser walkthrough** — no local backend/DB running
      in this environment (consistent with every other DB-dependent check
      this session), so the builder panel and consent screen were verified
      by type-checking + production build only, not by clicking through them
      in Chrome. Flagged rather than silently skipped.
- [ ] **Real gap, not fixed: 22 scheduled languages.** The app has
      infrastructure for 4 (`en`/`hi`/`kn`/`te`). Getting to all 22
      8th-Schedule languages needs either a much larger translation-content
      pipeline or reusing the existing `POST /ai/translate` endpoint to
      machine-translate notice text on demand — neither built this pass;
      the notice mechanism itself is designed so adding more language codes
      later is additive (new entries in `LANGUAGE_OPTIONS`), not a rebuild.
- [ ] **Real gap, not fixed: true audio read-out (TTS).** No text-to-speech
      integration exists in the stack. Shipped the achievable piece instead —
      an admin can paste a link to a **pre-recorded** audio file per
      language (uploaded via the existing Shared Files feature) and it plays
      in the consent screen. Automatic TTS generation is separate, sizeable
      follow-up work, not attempted against non-existent infrastructure.

### 6. Per-purpose consent — `in-progress` (core built + verified)
- [x] **Separate per-purpose consent + blocking — done 2026-09-18.** Consent
      gate (from item 5) now shows a checkbox per optional purpose the form
      actually uses — auto-detected from field types present
      (`photo`/`audio`/`gps`), plus an opt-in "follow-up contact" toggle a
      form builder can enable (`consent_notice.ask_followup`, since no field
      type implies it). `FormRenderer`'s `allFields` list — the single place
      every other part of the renderer (paging, progress bar, validation,
      submit) already reads from — now filters out any field whose type
      maps to a declined purpose (`purposeOfFieldType()`), so a declined
      purpose is genuinely unreachable, not just hidden by convention.
      GPS capture and the background audio-audit recorder (existing QC
      feature) both independently check the same declined-purposes set
      before touching `navigator.geolocation` / `getUserMedia` — a declined
      purpose is never silently captured behind the respondent's back.
      "Survey answers" (text/number/choice/etc.) are core and can only be
      declined by declining the whole form (existing "I Don't Agree" flow),
      matching the audit's own framing.
- [x] **Oral consent + enumerator attestation — done 2026-09-18.** Consent
      screen has a "consent given orally" checkbox; when checked, reuses the
      existing `AudioField` component (same one used for in-form audio
      questions) to optionally record proof — zero new recording code
      written, this is the identical `MediaRecorder` component instantiated
      once more.
- [x] **Stored with each submission — done 2026-09-18.** `_consent_purposes`
      (per-purpose true/false map), `_consent_oral`, `_consent_oral_audio`
      stamped into `data_json` alongside item 5's `_consent_notice_version`/
      `_consent_language`/`_consent_given_at` — same established convention.
      All 6 keys added to `field_govern.py`'s AI-exclusion set (so a
      respondent's raw oral-consent audio clip can never reach an AI call),
      and surfaced in both `_sub_summary()` (submissions list) and
      `GET /forms/{id}/consent-log`. Pre-emptively also excluded
      `_consent_withdrawn_at` — item 7's key, not written yet, but excluding
      it now means item 7 doesn't have to touch this set again.
      **Enumerator ID and language were already captured** (existing
      `Submission.enumerator_id` column; `_consent_language` from item 5) —
      no new work needed for those two.
- [x] **Fixed a real bug found while building this — done 2026-09-18.**
      `showManualNext`/`currentHasValue` dereferenced `currentField.type`/
      `.name` unconditionally, before the existing null-check that handles
      "form has no questions." This was already a latent crash for a
      genuinely empty form; per-purpose filtering made it **much** more
      likely to actually fire — any form made entirely of one purpose type
      (e.g. an all-photo checklist) now legitimately produces an empty
      `allFields` on the consent screen itself (purposes default to
      "not yet decided" = filtered out until consent is given), which would
      have crashed the component on load. Made both null-safe, and replaced
      the old blunt "This form has no questions" dead-end with a real
      screen for this specific case: if a respondent declines every purpose
      the form uses, they can still submit — an empty-answers record that
      honestly reflects what they declined, rather than being stranded.
- [x] **Verified:** `npx tsc --noEmit --skipLibCheck` clean; `npm run build`
      (incl. service worker) succeeds. Backend: `py_compile` clean; full
      pytest suite 39 passed / 76 skipped / 0 failed (unchanged from item 5
      — no DB-dependent test added for this item, flagged below).
- [ ] **Real gap, not fixed: device ID.** No device-identifier capture
      exists anywhere in the codebase today (checked `Submission` model and
      both submission-write paths) — storing one is separate, sizeable
      follow-up work (needs a stable per-device ID scheme, likely
      `localStorage`-persisted UUID, plus a DB column and both write paths
      touched), not attempted against non-existent infrastructure.
- [ ] **Not done: automated test for the purpose-filtering/blocking logic.**
      `purposeOfFieldType()` and the `allFields` filter are pure functions
      in principle but currently live inline inside the component rather
      than as an exported, independently-testable unit — worth extracting
      if this logic grows more branches; not done this pass since it's
      still simple enough to verify by direct code trace (documented above).

### 7. Consent withdrawal — `in-progress` (core built + verified)
- [x] **Reference code, derived not stored — done 2026-09-18.** Rather than
      generate and persist a new random code (new column, new write path,
      new place to leak), the code is a formatted view of the submission's
      own `local_id` — already an indexed column, already populated by
      **both** real respondent-facing write paths (`sync.py push` for the
      offline-first enumerator PWA, `public_survey.py _persist_submission`
      for self-serve public surveys). `refCodeFromId()`
      (`frontend/src/lib/consentRefCode.ts`) formats the last 8 hex chars as
      `XXXX-XXXX` — computable instantly, client-side, fully offline, no
      server round-trip. Shown on both real confirmation screens:
      `FieldApp.modern.tsx`'s "Saved!" screen and `PublicSurveyPage.tsx`'s
      "Thank you!" screen — the actual respondent-facing UI. (The direct
      `POST /submissions/` API-ingestion path, used only by external
      API-key integrations/bulk import, doesn't set `local_id` — no live
      respondent to hand a slip to on that path, so no ref code there;
      documented as an intentional scope boundary, not an oversight.)
- [x] **Admin lookup + withdrawal, reusing item 9's erasure — done
      2026-09-18.** Extracted the wipe-answers/GPS/media + audit-log core of
      `anonymize_submission` (item 9) into a shared `_erase_submission_row()`
      helper, so withdrawal triggers the *exact same* erasure — not a
      parallel reimplementation — with a distinct audit action label
      (`consent_withdrawn` vs `submission_anonymized`) so the two stay
      distinguishable in the log. New `GET /submissions/consent-withdrawal/
      lookup` (preview only, no side effects — lets staff confirm they've
      found the right response before erasing) and
      `POST /submissions/consent-withdrawal/withdraw`, both `org_admin`+
      (routine/frequent action, unlike `anonymize`'s `master_admin`-only
      gate). Tenant-scoped suffix match on `local_id` (≥6 hex chars
      required; 0 matches → 404, >1 → 409 asking for the fuller code —
      astronomically unlikely collision space at 8 hex chars, but handled
      honestly rather than assumed away). A `_consent_withdrawn_at`
      timestamp is written back after the wipe (erasure clears `data_json`
      to `{"anonymized": True, ...}`, then this key is added back) so
      "was this respondent's withdrawal honoured" stays provable even after
      their data is gone.
- [x] **Admin UI — done 2026-09-18.** New "Consent Withdrawal" card in
      `OrgAdminPanel.modern.tsx`'s Security tab (the tenant's existing home
      for compliance/access tooling — 2FA, QR login, AI config already live
      there): paste the code → look up → confirm → withdraw, with an
      already-withdrawn state so staff don't double-erase.
- [x] **Caught and fixed a real bug before shipping — `re` module was never
      imported in `submissions.py`.** `py_compile` doesn't catch this (not a
      syntax error, only fails at the exact moment the new endpoint runs) —
      caught by actually running the new pytest file, then confirmed fixed
      by both re-running the tests and a genuine `import app.api.routes.
      submissions` (not just compiling it) before shipping.
- [x] **Verified:** new `backend/tests/test_consent_withdrawal.py` (5 pure
      cases — dashed/undashed/whitespace/non-hex-char normalization, plus a
      case pinning the exact JS↔Python round-trip assumption that a UUID's
      last 8 characters are always dash-free) — all pass. Full backend
      suite: 44 passed / 76 skipped / 0 failed (up from 39). `py_compile`
      clean; module actually imports clean. `npx tsc --noEmit` clean;
      `npm run build` (incl. service worker) succeeds.
- [ ] **Not done: SMS delivery of the code.** The requirement's "printed
      slip **or SMS**" — only the on-screen/printable display is built.
      Texting it would reuse the existing MSG91/WhatsApp notification
      services already in the codebase (`services/whatsapp.py`,
      `notification_config`), but needs a phone-number capture point in the
      respondent flow that doesn't exist today — real follow-up work, not
      attempted this pass.

### 8. Data-principal rights workflow — `in-progress` (core built + verified)
- [x] **New tracked entity — done 2026-09-18.** `data_rights_requests` table
      (migration `0058`) — this is a genuinely new case-tracking object, not
      an extension of something existing: request type (access/correction/
      erasure/portability), requester name/contact, optional nominee
      name/contact, status (open/verifying/in_progress/closed), identity-
      verified flag, linked submission ids (JSONB array), resolution note,
      `sla_due_at` (computed at creation = now + 30 days, the Rules' aim).
      **Brought under the same DB-level tenant isolation as everything
      else** — a second migration (`0059`) enables/forces RLS + the
      `tenant_isolation` policy on it, since RLS enforcement (item 2) is
      live in prod and a new table created after migration 0048 doesn't
      inherit that automatically; without this it would've been the one
      tenant-scoped table with no DB-layer defense-in-depth. Registered in
      the soft-delete bin registry too, matching every other entity.
- [x] **Log → verify → search → act → close, end to end — done 2026-09-18.**
      New `backend/app/api/routes/data_rights.py` (9 endpoints, all
      `org_admin`+): create, list (with `overdue_only` filter), get,
      update (status/identity_verified/resolution_note/nominee), search,
      act, close, delete, and an `overdue-count` badge endpoint.
      **Search reuses existing infra, not a new identifier concept**: the
      "find this respondent across all forms/waves" requirement is served
      by `pii_redact.identifier_field_ids()` — the same `is_identifier`
      field flag already used to strip PII before AI calls — searched
      against every one of the tenant's forms via JSONB field lookups;
      matches accumulate into `linked_submission_ids` across repeated
      searches rather than overwriting.
      **Erasure is the third call site now reusing the same core**: `act`
      with `action=erase` calls the exact `_erase_submission_row()` helper
      extracted for item 7's consent withdrawal, which itself came from
      item 9's `anonymize_submission`. One erasure implementation, three
      entry points (master_admin direct anonymize, org_admin consent
      withdrawal by ref code, org_admin data-rights erasure), each with
      its own audit action label so the log stays distinguishable.
      **Export** (`action=export`) returns a machine-readable JSON bundle
      of every linked submission's full `data_json` — the portability/
      access right — downloaded directly from the new admin UI.
- [x] **SLA tracking + overdue signal — done 2026-09-18.** `_serialize()`
      computes `is_overdue` (past the 30-day target, not yet closed) and
      `is_past_outer_limit` (past the 90-day Rules maximum) on every
      response — pure function, covered by 4 standalone unit tests
      (`backend/tests/test_data_rights.py`, no DB needed): fresh request
      not overdue, past-target flagged, past-outer-limit flags both, and
      critically — a closed request is never flagged overdue regardless of
      age, so resolved cases don't pollute the alert view. Overdue requests
      get a visible red badge in the new admin table +
      `GET /data-rights/overdue-count` for a future dashboard badge.
- [x] **Admin UI — done 2026-09-18.** New `frontend/src/admin/
      DataRightsPage.tsx` at `/data-rights` (`org_admin`/`master_admin`,
      new Sidebar nav entry "Data Rights"): request list with status/SLA
      badges, a "Log Request" modal, and a detail modal covering identity
      verification, search, linked-submission chips, export/erase actions,
      and close.
- [x] **Nomination support (partial, by design).** Nominee name/contact are
      captured as fields on the request and editable — enough to record
      *who* is acting on the respondent's behalf and why, which is the
      practical need day-to-day. A full "verify nominee's legal standing"
      workflow (death certificate upload, guardianship proof, etc.) is out
      of scope — that's a legal/process question for the org's own
      grievance procedure, not something software can adjudicate.
- [x] **Verified:** `npx tsc --noEmit` clean; `npm run build` (incl. service
      worker, 64 precached entries, up from 63) succeeds. Backend:
      `py_compile` clean on all 8 touched/new files; the full `app.api.
      router` was actually **imported** (not just compiled) to confirm no
      runtime-only errors — 9 `/data-rights/*` routes registered correctly.
      Full pytest suite: 48 passed / 76 skipped / 0 failed (up from 44).
- [ ] **Not done: proactive overdue alerts (email/push).** Overdue status is
      visible in the UI and via the count endpoint, but nothing emails or
      pushes a notification when a request crosses its SLA. The existing
      digest-email service (`services/digest.py`) sends tenant-wide daily
      summaries and isn't wired to per-object deadlines like this one —
      extending it is real follow-up work, not attempted against a system
      not designed for it, rather than bolting on a parallel one-off
      notification path.
- [ ] **Not done: SLA/outer-limit day counts (30/90) are hardcoded
      constants**, not a per-tenant configurable setting — matches the
      Rules' own fixed numbers, so not flagged as a real gap, just noted
      for completeness.

### 9. Erasure completeness — `in-progress` (data + files done, 2 gaps remain)
- [x] **Photos, audio, GPS — done 2026-09-18.** `POST /submissions/{id}/anonymize`
      previously only wiped `data_json`, leaving GPS columns (`gps_open`/
      `gps_submit`, separate top-level columns, never touched) and every
      uploaded photo/audio file (a `MediaFile` row + a real object in storage)
      completely untouched. Fixed: now also nulls both GPS columns, and for
      every `MediaFile` tied to the submission, deletes the actual storage
      object (`storage.delete(key)`) then the DB row. The storage key isn't
      stored anywhere on `MediaFile` — reconstructed it using the exact same
      formula `upload_media()` (`sync.py`) already uses to build it
      (`{tenant_id}/{submission_id}/{field_name}{ext}`), rather than adding a
      redundant column. Self-check
      (`backend/tests/test_erasure.py`, 3 cases) verifies the reconstructed key
      matches `upload_media`'s own formula byte-for-byte, including the
      `.bin`-fallback and codec-param-stripping edge cases. File-delete
      failures are caught and counted but never block the data_json/GPS wipe
      (the part that matters most must always complete) — failure count is
      returned in the response and written to a new audit-log entry
      (`action=submission_anonymized`) so an erasure that partially failed on
      storage is still visible, not silently "successful."
- [x] **Exports — verified already fine, no fix needed.** Checked every export
      route in `export.py`: every one uses `StreamingResponse` / an in-memory
      buffer, generated fresh from the DB on each request — nothing is cached
      to disk per submission. Once `data_json` is anonymized, the next export
      naturally reflects that; there was never a separate stored copy to erase.
- [x] **Backups — verified an expiry policy already exists, just wasn't
      documented as satisfying this requirement.** `deploy/backup-db.sh`
      already prunes local backups after 7 days and (when R2 offsite is
      configured) R2 copies after 30 days — a real, bounded backup-expiry
      window, meaning anonymized data ages out of every backup within 30 days
      max. This already meets the audit's ask; it just needed connecting to
      the compliance requirement's language, not new engineering.
- [ ] **Real gap, not fixed: Google Sheets copies.** Once a submission's data
      is pushed to a customer's Google Sheet (`sheets_sync.py`), FieldGovern
      has no way to find and blank that specific row — there's no stored
      mapping from submission → sheet + row. Building one is a real, separate
      piece of work (needs mapping every synced row, not just future ones).
- [ ] **Real gap, not fixed: cached AI outputs.** Saved report drafts (AI
      Writer) or tabulation results that happen to quote a submission's raw
      free-text answer have no traceable link back to that submission — no
      way to find "every report that might mention submission X" to redact it.
      Would need either avoiding raw free-text in saved AI output in the first
      place, or tracking provenance per generated report — non-trivial,
      flagged as follow-up rather than half-built.

### 10. Encryption at rest — `in-progress` (code-buildable pieces built + verified)
- [x] **TLS 1.2+, HSTS — already satisfied, verified not rebuilt.** Checked
      rather than assumed: `deploy/nginx.conf:24` already pins
      `ssl_protocols TLSv1.2 TLSv1.3` (no legacy versions); `main.py`'s
      `SecurityHeadersMiddleware` already sets
      `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
      Both pre-existing, nothing to build.
- [x] **"Secure cookies" — not applicable, confirmed not just skipped.**
      Grepped every route for `set_cookie` — zero results. Auth is pure JWT
      bearer-token (Authorization header, tokens held client-side), no
      cookie-based session state exists anywhere in the app, so there is
      nothing to mark Secure/HttpOnly/SameSite. Documented so this doesn't
      get re-investigated as if it might be a real gap.
- [x] **Aadhaar minimisation — done 2026-09-18, and arguably the stronger
      fix than encryption for this specific requirement.** The audit's
      "never store full Aadhaar numbers" is best satisfied by never holding
      a reversible full copy at all — nothing to decrypt is nothing to leak.
      New `pii_redact.mask_aadhaar()` (reuses the module's own existing
      `_AADHAAR_RE`) replaces any 12-digit Aadhaar-shaped sequence with
      `XXXX-XXXX-<last 4>`, irreversibly, at write time — before the value
      is ever persisted, so **every existing read path (exports, analyzer,
      dashboards, AI redaction, duplicate detection) needed zero changes**,
      since a masked string displays exactly like any other short string.
      Wired into **every** place a submission's `data_json` is written or
      replaced, found by grepping for `Submission(`/`.data_json =` across
      the whole backend rather than assuming the obvious 1-2 spots:
      `submissions.py` (create, draft upsert, direct data edit),
      `sync.py` (offline push — both the main-path and conflict-resolution
      branches), `public_survey.py` (public self-serve submit),
      `bulk_upload.py` (Excel bulk import), `migration/router.py`
      (Kobo/SurveyCTO/ODK import — also flows into the returned
      `data_rows` used for downstream Sheets sync, so that gets the masked
      version too, not the raw one). 8 pytest cases
      (`backend/tests/test_pii_redact.py`) cover: spaced/unspaced Aadhaar,
      masking mid-sentence, non-Aadhaar strings passing through untouched,
      list values, non-string passthrough, and that the original dict
      passed in is never mutated in place.
- [x] **Envelope-encryption primitive built — done 2026-09-18, not yet
      wired to identifier fields (see gap below).** New
      `backend/app/core/field_crypto.py` — same proven shape as the
      existing `tenant_ai_crypto.py` (Fernet keyed via HKDF from
      `JWT_SECRET`, independent derived key via a distinct HKDF info
      string, no new required env var, no new managed-KMS dependency for
      this code-buildable piece). 4 pytest cases
      (`backend/tests/test_field_crypto.py`): round-trip, empty-string
      safety, tamper/corruption correctly raises rather than silently
      passing, and same-plaintext encrypts to different ciphertext each
      time (Fernet's IV — otherwise identical values would be
      correlatable at rest without ever being decrypted).
- [x] **Verified:** `py_compile` clean on all 8 touched/new files; the full
      `app.api.router` actually **imported** (302 routes registered,
      confirming no runtime-only import errors across every touched
      module). Full pytest suite: 60 passed / 76 skipped / 0 failed (up
      from 48). No frontend changes this item.
- [ ] **Real gap, not fixed: field-level encryption not wired to
      `is_identifier` fields yet.** The primitive (`field_crypto.py`) is
      built and tested, but actually encrypting name/phone/other
      `is_identifier=True` field values inside `data_json` — as opposed to
      Aadhaar, which is minimised rather than encrypted — needs a genuinely
      staged rollout that a single pass shouldn't attempt against live
      production data: every read path that touches `data_json` (exports,
      analyzer, cleaner, dashboards, duplicate detection, AI redaction,
      consent-log, the new data-rights search) would need decrypt-aware
      reads shipped *before* any write starts encrypting, plus a backfill
      script for every existing unencrypted row. Flagged as real follow-up
      work, not attempted as a single risky pass.
- [ ] **Real gap, not fixed: exact GPS.** Same reasoning as identifier
      fields — `gps_open`/`gps_submit` are read directly by the submissions
      map, exports, and geofence checks; encrypting them needs the same
      staged read-path retrofit. Unlike Aadhaar, GPS precision can't be
      safely minimised without changing what the org actually asked for
      (map accuracy), so masking isn't a substitute fix here the way it was
      for Aadhaar — this one genuinely needs the full encryption retrofit.
- [ ] **Not fixed (ops, tracked separately): disk + object-storage +
      backup encryption via a managed KMS in an Indian region.** Owner's
      server-rebuild plan already covers this — see the existing note
      below and `tasks/pending_owner_action.md` §2-3; not a code change.
- [ ] **Not fixed: scheduled key/secret rotation + rotation on staff
      exit.** No rotation schedule or staff-exit-triggered rotation
      process exists for `JWT_SECRET` or the Fernet-derived keys above —
      an ops/process gap, not something this pass built tooling for.

**Verified live 2026-09-18 — disk encryption still open, owner has committed a
timeline.** Disk is not encrypted (unmanaged Contabo VPS, confirmed via `lsblk`
— no `crypt` layer). Owner's plan: back up, then rebuild the server on a fresh
encrypted volume, bundled with the region move (item 3's finding below) rather
than two separate migrations — timeline "a couple of days" as of 2026-09-18.

Backup job itself confirmed genuinely working (69 backups, one full restore
test passed — 4 tenants recovered correctly into a throwaway DB). Automated
R2 offsite sync was never configured, but owner has a separate manual process
(copies to Drive, downloaded periodically) — parked intentionally, not being
automated. Full detail in `tasks/pending_owner_action.md` §2.

**Region confirmed EU, not India** (§3 of the same file) — owner committed to
moving to an India region within days, same server rebuild as the disk-
encryption fix above.

**Verified live 2026-09-18 — disk encryption still open, owner has committed a
timeline.** Disk is not encrypted (unmanaged Contabo VPS, confirmed via `lsblk`
— no `crypt` layer). Owner's plan: back up, then rebuild the server on a fresh
encrypted volume, bundled with the region move (item 3's finding below) rather
than two separate migrations — timeline "a couple of days" as of 2026-09-18.

Backup job itself confirmed genuinely working (69 backups, one full restore
test passed — 4 tenants recovered correctly into a throwaway DB). Automated
R2 offsite sync was never configured, but owner has a separate manual process
(copies to Drive, downloaded periodically) — parked intentionally, not being
automated. Full detail in `tasks/pending_owner_action.md` §2.

**Region confirmed EU, not India** (§3 of the same file) — owner committed to
moving to an India region within days, same server rebuild as the disk-
encryption fix above.

### 11. Logs — `in-progress` (tamper-evidence + anomaly alerts built + verified)
- [x] **Tamper-evident hash chain — done 2026-09-18.** New
      `backend/app/services/audit.py`: `write_audit()` is now the single
      correct way to write an `AuditLog` row — every one of the 6
      pre-existing direct `AuditLog(...)` constructions across
      `admin_monitor.py`, `razorpay_billing.py`, `submissions.py`,
      `tenants.py`, and `two_factor.py` (via its existing `_write_audit`
      wrapper, signature unchanged) was converted to call it instead; grep
      confirms zero direct constructions remain outside `audit.py` itself.
      Each row's `row_hash` (migration `0057`, patched into `seed_dev.py` +
      `wait_and_stamp.py` per repo convention) is a SHA-256 over the row's
      own content **plus** the immediately-preceding row's hash, scoped
      per-tenant — editing or deleting any historical row breaks every
      later row's hash. `verify_audit_chain(db, tenant_id)` walks the chain
      and reports `{valid, checked, skipped_unchained, broken_at_id, reason}`;
      rows written before this migration (`row_hash IS NULL`) are skipped,
      not falsely flagged as tampered — there's no way to retroactively
      prove their original content, so verification honestly only covers
      what's written from here on.
- [x] **Anomaly detection (2 of 3 named patterns) — done 2026-09-18.**
      `detect_anomalies(db, tenant_id, since=None)` flags
      `repeated_failed_logins` (≥5 failures for one user within a rolling
      30-minute window — sliding, so a burst spanning a bucket boundary is
      still caught) and `off_hours_access` (successful password checks
      23:00–06:00 IST). This required a prerequisite fix: **failed logins
      and successful password checks were never logged at all** before this
      change — `auth.py`'s `login()` now logs `login_failed` (only when an
      active user was found but the password was wrong — no tenant to
      scope an unknown identifier to) and `login_password_verified`
      (deliberately not "login_success" — logged before any 2FA branch,
      since a correct password at 2 AM is a meaningful signal regardless of
      whether 2FA later blocks the session; inline comment documents that
      logging the fully-completed post-2FA session would need instrumenting
      `two_factor.py`'s confirm endpoint too, flagged as follow-up, not done).
- [x] **RBAC gap fixed in passing:** `GET /audit/` had no role restriction —
      any authenticated user, including `enumerator`, could read the full
      tenant audit log (IP addresses, action detail). Found while working
      this item, fixed in the same file rather than deferred: now
      `require_role("org_admin", "supervisor")`, matching the existing
      `export.csv` endpoint's `org_admin`-only gate one function below it.
- [x] **Both functions exposed via API** — `GET /audit/verify-chain` and
      `GET /audit/anomalies?since_hours=` (default 24, capped at 30 days),
      both `org_admin`-only, added to the existing `audit.py` router.
- [x] **Verified:** `audit.py`'s own `__main__` self-check (hand-rolled fake
      DB, no real DB needed) covers chain creation, hash uniqueness, tamper
      detection via content mutation, tamper detection via `prev_hash`
      mutation, correct skip-behaviour for pre-chain legacy rows, and (added
      this pass) `detect_anomalies` — 5 failed logins in-window flagged with
      the right count, an off-hours login flagged, a normal daytime login
      NOT flagged. Ran clean: `audit self-check: OK`. New
      `backend/tests/test_audit.py` (6 DB-integration cases: chain validity,
      tamper detection, legacy-row skipping, repeated-failed-logins,
      daytime-not-flagged) collects cleanly, skips without a test DB
      (consistent with every other DB-backed test this session). Full
      backend suite re-run clean: 33 passed, 76 skipped, 0 failed — no
      regressions. All 9 modified/new files pass `py_compile`.
- [ ] **Real gap, not fixed: "mass export."** The third named anomaly
      pattern has no underlying data — no export route (~9 of them) writes
      an audit entry today. Instrumenting all of them is separate, sizeable
      follow-up work; intentionally not half-built against data that
      doesn't exist.
- [ ] **Not fixed: ≥1 year retention enforcement.** Nothing currently prunes
      `audit_log` — it grows unbounded, which technically satisfies "≥1
      year" but doesn't enforce or bound it. No deletion-after-N-years job
      exists.
- [ ] **Not fixed: India-region storage for logs**, and **separate 180-day
      ICT log retention per CERT-In** — both ops/infrastructure-level
      requirements tied to the same server-region decision already tracked
      in item 10 (owner committed to an India-region rebuild "in a couple
      of days" as of 2026-09-18) and `tasks/pending_owner_action.md`, not
      something this code change addresses.
- [ ] **Not fixed: NIC/NPL NTP clock sync** — ops-level server config, not
      verified either way this pass; flagged as open.

### 12. Breach response — `in-progress` (plan written, owner input needed to finish)
- [x] **Full written plan — done 2026-09-18.** New `deploy/BREACH_RESPONSE_PLAN.md`:
      breach definition + what's explicitly NOT a breach (avoids false-alarm
      fatigue), 4-level severity classification (P0-P3) with concrete
      examples, a role table (Incident Commander/Technical Lead/Grievance
      Officer/Communications/Legal), the full CERT-In ≤6h / customer ≤24h /
      Board ≤72h timeline, a containment checklist that **cross-references
      real, built capabilities** rather than generic advice — `GET /audit/
      verify-chain` to confirm the audit log itself wasn't tampered with
      during the incident, `GET /audit/anomalies` to scope related
      suspicious activity, `tasks/pending_owner_action.md` for known
      credential-rotation steps — a forensic-log-preservation checklist, 3
      pre-drafted notification templates (CERT-In initial report, customer
      notice, Board detailed report) with the actual required fields filled
      in as instructions, and a twice-yearly tabletop-exercise procedure
      with a place to log findings.
- [x] **Refreshed the existing runbook while in the area — done 2026-09-18.**
      `deploy/SECURITY_DPDP_RUNBOOK.md` had drifted stale during this
      session's own work: §2 still said "code done, switch to enable" for
      tenant isolation, which has been **live in production** since this
      session activated it; the quick-status table didn't mention any of
      items 5/6/7/8/9/10/11/13 shipping. Corrected both, and pointed §5's
      one-line breach bullet at the new full plan instead of leaving it as
      a stub next to a real document that now exists.
- [ ] **Not done — genuinely can't be done from here: contact details.**
      Every `[name, phone, email]` placeholder in the plan (Incident
      Commander, Technical Lead, Grievance Officer, Communications, Legal)
      needs the owner to fill in real people — this isn't something
      derivable from the codebase, and a document with fabricated contacts
      would be actively worse than an honest placeholder someone might
      still fill in.
- [ ] **Not done: the first tabletop exercise itself.** The procedure exists
      (§8 of the plan) but running it is a scheduled team activity, not a
      code or doc deliverable — flagged as the next concrete action once
      contacts are filled in.

### 13. Children & vulnerable groups — `in-progress` (core built + verified)
- [x] **Age-screening + guardian consent + flag/restrict — done 2026-09-18.**
      Found the age-check mechanism (`age_gte`/`age_lt` skip-logic operators) already
      existed in the form schema/renderer — no new client-side gating code needed.
      Built the missing piece: two new opt-in `FormField` flags,
      `is_dob_for_screening` and `is_guardian_consent` (exact same UI/toggle pattern
      as the existing `is_identifier` flag — `FieldEditor.tsx`), so a form builder
      marks which date field is the DOB and which field captures guardian consent.
      New `backend/app/services/child_protection.py`
      (`compute_child_protection_status`) — pure function, form schema + answers in,
      `{is_minor, guardian_consent_given}` out — wired into **both** submission
      write paths (`POST /submissions/` and `POST /sync/push`, the two independent
      code paths that construct `Submission` rows). New columns
      `Submission.is_minor` / `guardian_consent_given` (migration `0056`, patched
      into `seed_dev.py` + `wait_and_stamp.py` per repo convention).
      **Enforcement, not just storage** — two real consumers wired: (1)
      `GET /submissions/` hides `is_minor=True` rows by default for every role,
      and **unconditionally** for `enumerator` regardless of any query param
      (can't be bypassed via `ids=`) — `org_admin`/`supervisor`/`master_admin` can
      opt in via `include_minors=true`, same pattern as the existing
      `duplicate_only` filter; (2) the two direct AI-facing submission queries
      (`ai.py generate_report`, `field_govern.py _run_ai_generation`) now filter
      `is_minor == False` — a flagged submission's data can never reach either AI
      report-writing path. Checked every other `Submission` query in
      `field_govern.py` individually before deciding what to touch — one
      (`refresh_analysis`) is explicitly non-AI per its own docstring, correctly
      left alone; `get_cleaner_data` feeds a general human-editable data view, not
      only AI, so filtering there would wrongly hide minors' records from
      legitimate manual (non-AI) correction — left alone, flagged as a real
      follow-up gap below instead of overreaching.
      Self-check (`child_protection.py`'s own `__main__` block, 9 cases) caught a
      real bug before shipping: `guardian_consent_given` was defaulting to `False`
      instead of `None` for adult respondents whose form never showed the consent
      question — fixed to only evaluate consent when `is_minor` is actually `True`.
      Pytest suite `backend/tests/test_child_protection.py`: 4 pure-logic cases
      pass standalone (no DB needed); 4 end-to-end cases (submission creation via
      HTTP, list-visibility for enumerator/org_admin with/without `include_minors`)
      collect cleanly but could not run end-to-end here (no test DB in this
      environment, consistent with every other DB-backed test this session).
      Full backend suite re-run clean (30 passed, up from 26). Frontend
      type-checks clean.
- [ ] **Real follow-up gap, not yet fixed:** the DataCleaner AI-suggestion path
      (`tools/datacleaner`, a separate microservice operating on arbitrary
      uploaded datasets) has no concept of `is_minor` at all — plumbing that flag
      through from FieldGovern to a raw uploaded CSV/Excel dataset is a
      genuinely separate piece of work, not done in this pass.
- [ ] Guardian-consent option for persons with disability — not built; the
      guardian-consent mechanism above is framed around age/minors specifically,
      not yet generalised to a disability-related guardian flow.
- [ ] "No photos without specific guardian consent" — achievable today by a form
      builder using existing skip logic (gate the photo field's visibility on the
      guardian-consent field), but not enforced/validated server-side as an
      invariant — an admin has to configure it correctly, nothing stops a
      misconfigured form from allowing a photo without consent.

### 14. Processor contract — `in-progress` (DPA template + sub-processor list + per-request certificate done)
- [x] **Sub-processor list — done 2026-09-19.** New `deploy/SUB_PROCESSORS.md`
      — built from actually checking every real integration in the
      codebase (`grep`-verified every service in `backend/app/services/`,
      `storage.py`, and the frontend's analytics setup) rather than
      guessing: hosting, AI providers, Google Sheets/Drive/OAuth, SMTP,
      MSG91, WhatsApp, Telegram, Razorpay, Sentry, and **PostHog** — found
      via this check, not previously documented anywhere as a
      sub-processor (US-hosted usage analytics, `main.tsx`). Explicitly
      notes what's placeholder (hosting region, SMTP provider — both
      operator-configured at runtime, not hardcoded, so can't be verified
      from code) versus real. Explicitly excludes Redis/self-hosted
      storage as not being third-party sub-processors in the DPDP sense.
- [x] **DPA template — done 2026-09-19.** New `deploy/DPA_TEMPLATE.md` —
      a real, structured starting point (scope, obligations, sub-processor
      notification, breach timelines, residency, audit rights, term) that
      cross-references the actual built mechanisms (`/data-rights`,
      `verify-chain`, the breach plan) rather than generic boilerplate —
      explicitly flagged as needing lawyer review before use (item 20),
      with every business-specific blank left as a placeholder rather than
      invented.
- [x] **Deletion certificate — done 2026-09-19, scoped to per-request
      erasure (not full contract-end).** New
      `GET /data-rights/{id}/certificate` — only issuable for a **closed**
      request, so it never certifies something that hasn't actually
      happened. Generates a real PDF (reuses the exact `fpdf2` pattern
      already used by `export.py`'s PDF report) with org name, request
      details, records covered, and an honest scope note (what "records
      covered" actually means — submissions linked to the request at
      closing time). New "Download Deletion Certificate" button in
      `DataRightsPage.tsx`'s detail view, shown once a request is closed.
      Verified: `py_compile` clean; `app.api.router` actually imported
      (303 routes, up from 302); full backend suite 72 passed / 79
      skipped / 0 failed; `npx tsc --noEmit` clean; `npm run build`
      succeeds.
- [ ] **Not done: full contract-end deletion process.** The certificate
      above covers individual data-rights erasure requests during an
      active contract — a genuinely different, larger feature ("delete
      everything for this entire tenant when their contract ends") has no
      equivalent workflow yet. Tracked as a real gap, consistent with the
      note already in the DPA template itself rather than silently
      assumed to be covered.

### 15. Device / offline security (PWA) — `in-progress` (3 real gaps found + fixed, 2 large ones deferred)
- [x] **`navigator.storage.persist()` + quota check — already fully built,
      verified rather than assumed.** Checked before building anything:
      `storage/index.ts`'s `getStorage()` (the single entry point every
      page uses) already calls `adapter.requestPersistence()` on every
      init and warns on <200MB free. `FieldApp.modern.tsx` also has its own
      UI banner for the low-storage case. Nothing to build here — this
      bullet was already satisfied.
- [x] **Auto-lock after inactivity — built but never wired, found + fixed
      2026-09-18.** Same pattern as item 16's 2FA-UI gap: a complete,
      working `useSessionTimeout` hook (28min warn / 30min expire,
      activity-event-based reset) and a polished `SessionTimeoutModal`
      component both already existed in the codebase — fully built,
      **zero imports anywhere**, dead code. Wired both into
      `RequireAuth.tsx`, the single choke point every authenticated route
      already passes through, so every staff-facing page gets this for
      free without touching individual pages. `onExpire` calls the same
      `logout()` every other logout path uses.
- [x] **Visible unsynced-items warning on logout — done 2026-09-18.**
      Found `FieldApp.modern.tsx` doesn't even use the shared `TopNav`
      component (no logout button there at all) — the offline outbox is
      device-scoped storage, not tied to any one page, so the fix had to
      live in `TopNav.tsx`'s existing logout-confirm flow, checking
      `getStorage()` directly rather than relying on a specific page's
      React state. Doesn't hard-block logout (a hard block could deadlock
      a shared/kiosk device with no connectivity at that exact moment) —
      shows the exact unsynced count inside the existing confirm dialog so
      it's impossible to miss.
- [x] **iOS Add-to-Home-Screen warning — done 2026-09-18.** Genuinely
      didn't exist (checked — zero UA-detection code anywhere). Added a
      dismissible banner on `FieldApp.modern.tsx` (the collection screen,
      where storage-eviction risk actually matters) — detects iOS Safari
      not running in standalone/installed mode, explains the real risk
      (Safari can evict IndexedDB under storage pressure), dismissal
      remembered per-device via `localStorage` so it doesn't nag.
- [x] **Verified:** `npx tsc --noEmit` clean; `npm run build` succeeds
      (65 precached entries, up from 64). No backend changes this item —
      full backend suite re-run as a sanity check anyway: 60 passed / 79
      skipped / 0 failed, unchanged.
- [ ] **Real gap, not fixed: on-device encryption keyed from an enumerator
      PIN.** No Web Crypto encryption of the local outbox exists — data
      sits in IndexedDB/OPFS in plain form until synced. A genuinely
      separate, sizeable feature (PIN enrollment UX, key derivation,
      encrypt-before-write and decrypt-before-read on every storage
      adapter call) — not attempted this pass rather than half-built.
- [ ] **Real gap, not fixed: server-side device de-registration.** No
      concept of a "device" exists server-side to revoke — this needs the
      same server-side token-revocation store flagged as missing in item
      16, plus a device-identity concept that doesn't exist yet either.
- [ ] **Minor, not fixed: "warn on denied storage" specifically.**
      `requestPersistence()`'s boolean return is currently fire-and-forget
      — low-quota is warned on, but an explicit persistence *denial* (as
      opposed to low space) isn't separately surfaced. Low value to chase
      further given low-storage already covers the practically important
      case.
- [ ] **Not done: the full offline test matrix** (low-end Android,
      multi-day offline, app kill, browser update, clock changes,
      interrupted sync) — this is a manual/device-lab QA exercise, not a
      code change; genuinely can't be executed from this environment.

### 16. Auth / access — `in-progress`
- [x] **2FA (TOTP) — real UI shipped, done 2026-09-18.** Backend TOTP already
      existed (`backend/app/api/routes/two_factor.py`: setup/verify/disable/
      confirm, QR + secret, wired into `/auth/login` — none of this was new)
      but had **zero frontend enrollment UI anywhere**, and the login page's
      OTP step was wired for the wrong flow entirely (`LoginPage.tsx` always
      called `/auth/verify-otp` — the separate tenant email-OTP endpoint —
      never `/auth/2fa/confirm`, so a TOTP-enabled account could not actually
      complete login through the UI). Fixed: `LoginPage.tsx` now branches on
      `method: "totp"` vs the email-OTP shape and calls the right endpoint;
      added a full 2FA section (QR enrollment, verify, disable) to
      `UserProfile.tsx`'s existing Security card — role-agnostic, so it's
      available to every role including `master_admin` (reachable via avatar
      menu → My Profile, same path as the already-working Change Password).
      Added `totp_enabled` to `GET /users/me` so the UI knows current state.
      New `backend/tests/test_two_factor.py` (5 cases: setup→verify, login
      challenge shape, confirm success/failure, disable) — collects and skips
      cleanly (no test DB in this dev environment, matches existing test
      convention) but **could not be run end-to-end here** (Docker Desktop not
      running) — run `pytest tests/test_two_factor.py -v` with a test DB up
      before trusting this fully, and do one manual browser QA pass (enable
      2FA on a test account → log out → log back in with a real authenticator
      code) before calling this `verified`. Still not *mandatory* — a user can
      choose not to enable it; making it required for admins/supervisors is
      the remaining sub-item below.
- [x] **MFA-mandatory — mostly already existed, found + completed the
      missing piece, 2026-09-18.** This bullet's own framing ("currently
      opt-in per user") turned out to be wrong — checked before building
      anything and found a **whole separate, already-working mandatory-MFA
      system**: `tenant.notification_config.two_fa_enabled` already forces
      email-OTP 2FA for every user in the tenant at login
      (`auth.py`'s `login()`, gated by a plan feature flag), toggled via
      the existing Security tab. What was actually missing was
      **role-scoping** — it was all-or-nothing (every role or none). Added
      `two_fa_required_roles` (empty = everyone, unchanged default
      behavior) to `SecuritySettingsUpdate`, `GET/PATCH /tenants/security`,
      and `login()`'s enforcement check, plus checkboxes in the Security
      tab to scope it to org_admin/supervisor/enumerator individually — so
      "mandatory for admins/supervisors" (the literal ask) is now directly
      settable without forcing OTP friction onto enumerators too.
- [x] **Login lockout — done 2026-09-18.** Rate limiting on the login
      endpoint already existed (slowapi, 5/minute) but that's per-IP
      request throttling, not per-account lockout — a distributed attempt
      pattern or a shared-IP office would sail through it. Added real
      per-account lockout: new `users.failed_login_count`/`locked_until`
      columns (migration `0060`); 5 failed attempts (same threshold
      `audit.py`'s anomaly detector already uses, for one consistent
      signal) locks the account for 15 minutes; the lock is checked
      **before** attempting password verification (skips the bcrypt
      compute, avoids a timing oracle, gives a clear "try again in N
      minutes" 423 instead of a misleading "invalid credentials"); the
      counter resets to zero on the next successful password verification.
      3 pytest cases (`backend/tests/test_login_lockout.py`): locks after
      threshold (even the correct password is rejected once locked),
      successful login resets the counter, an unlocked account behaves
      normally — collect cleanly, skip without a test DB (consistent with
      every DB-dependent test this session).
- [x] **Real finding, flagged not silently fixed: access tokens never
      expire by default.** `JWT_EXPIRE_MINUTES=0` (session ends only on
      explicit logout) — directly against "short-lived access tokens."
      Confirmed the reason this is now safe to change: `frontend/src/lib/
      api.ts` already has a working silent-refresh interceptor, and
      `POST /auth/refresh` already rotates the refresh token on every use
      (both preconditions for short-lived tokens working smoothly were
      already true, just not switched on). **Deliberately not flipped by
      this pass** — it's a config-only change affecting every currently
      active session on a live app with field enumerators mid-collection;
      recommendation + exact steps + a post-change verification checklist
      written to `tasks/pending_owner_action.md` §6, same pattern used for
      the tenant-isolation activation.
- [x] **Verified:** `py_compile` clean on all 6 touched/new backend files;
      `app.api.router` actually imported (302 routes, no runtime import
      errors); `npx tsc --noEmit` clean; `npm run build` succeeds. Full
      pytest suite: 60 passed / 79 skipped / 0 failed (up from 60 passed /
      76 skipped — 3 new lockout tests collected, all DB-dependent tests
      still skip cleanly in this environment).
- [ ] **Not done: SSO (SAML/OIDC).** Genuinely substantial, separate
      integration work — not attempted this pass.
- [ ] **Not done: server-side token revocation.** Refresh-token *rotation*
      exists (confirmed above); actual server-side revocation (a token
      blacklist/version so a specific stolen token can be invalidated
      before its natural expiry) does not. Real gap, needs a revocation
      store (Redis, already in the stack, would be the natural fit) —
      sizeable enough to be its own follow-up rather than bolted on here.
- [ ] **Not done: least-privilege analysis-only role.** A role with
      submission-read access but `is_identifier` fields always redacted
      (reusing `pii_redact.redact_row()`, which already exists for exactly
      this shape of problem) is a clean, buildable scope — flagged as a
      real, sizeable-enough-to-be-separate follow-up rather than squeezed
      into this pass. FieldGovern-staff-access-with-customer-approval is a
      process/contractual control, not something to fake in code.

---

## P1 / P2 — assurance

### 17. Independent assurance — `todo`
Annual penetration test by a CERT-In empanelled auditor (publish a summary letter).
ISO/IEC 27001 (+27701 for privacy) within 12–18 months. SOC 2 Type II if selling to
international funders.

---

## P2 — competitiveness / government readiness

### 18. Government hosting readiness — `todo`
Confirm current Mumbai hosting or move to a MeitY-empanelled cloud provider; be ready for
STQC/tender-specific audits and GIGW/WCAG 2.1 AA accessibility.

### 19. Secure development — `in-progress` (CI scanning + disclosure policy done)
- [x] **Dependency scanning — done 2026-09-18.** New `.github/dependabot.yml`
      covers every real package manifest in the monorepo, checked by
      grepping for all of them rather than assuming just frontend/backend:
      frontend (npm), backend (pip), and the two deployed sub-apps
      `tools/tableforge` (npm+pip) and `tools/datacleaner` (pip) — these are
      genuinely deployed parts of the product per the deploy pipeline's own
      "sync tool sources" step. Excluded `claude-mem-main/` and
      `hermes-agent-main/` after confirming they're `.gitignore`d local
      tooling clones, not part of the shipped product. Weekly checks,
      minor/patch grouped to reduce PR noise.
- [x] **Secret scanning — already enabled, verified not assumed.** Checked
      via the repo API rather than assuming: `secret_scanning` and
      `secret_scanning_push_protection` were already `enabled` (GitHub
      turns this on by default for public repos now). Enabled the one
      setting that was off: `dependabot_security_updates`.
- [x] **SAST — done 2026-09-18.** New `.github/workflows/codeql.yml` — CodeQL
      across both real languages in the repo (JavaScript/TypeScript,
      Python), on every push/PR to `main` plus a weekly scheduled scan.
- [x] **`security.txt` — done 2026-09-18.** RFC 9116 format at
      `frontend/public/.well-known/security.txt` — confirmed it actually
      gets served correctly rather than assumed: traced `main.py`'s SPA
      catch-all route, which checks `file_path.is_file()` before falling
      back to `index.html`, so a real static file at that path is served
      as-is. Verified in the production build output
      (`dist/.well-known/security.txt` exists with the right content).
      Contact uses the one real, working address found on the marketing
      site (`hello@fieldgovern.com`) rather than inventing an unmonitored
      `security@` alias.
- [ ] **Not done: code review on every change.** This repo's whole working
      pattern this session (and presumably in general) is direct pushes to
      `main` with CI auto-deploy — enabling mandatory PR review would
      break that established workflow contract. A process/policy decision
      for the owner, not something to silently switch on.
- [ ] **Not done: separate dev/staging/prod.** Confirmed single-environment
      setup (one Docker Compose prod stack, no staging tier observed this
      session). Setting up a real staging environment with synthetic (not
      real personal) data is genuine infrastructure work, not a config
      flip — flagged, not attempted.
- [ ] **Not done: container scanning specifically** (e.g. Trivy/Grype
      against the built Docker images) — Dependabot covers source
      dependencies but not vulnerabilities baked into base images; a
      reasonable small follow-up (a CI step scanning the image before
      push) but not built this pass.
- [x] **Enabling scanning immediately surfaced a real finding — fixed, not
      just logged.** GitHub's vulnerability alerts (a side effect of
      enabling `dependabot_security_updates` above) reported 140 existing
      alerts (2 critical, 69 high, 57 medium, 12 low) the moment scanning
      turned on. Pulled the 2 critical ones specifically rather than just
      noting the count: **`python-jose` — algorithm confusion with OpenSSH
      ECDSA keys (< 3.4.0), patched in 3.4.0.** This library signs/verifies
      *every* login token in the app (`app/core/security.py`), so this
      wasn't a theoretical risk to leave for later — checked
      `JWT_ALGORITHM` is hardcoded to `HS256` only (no multi-algorithm
      acceptance, so the specific ECDSA-confusion vector doesn't directly
      apply to this app's usage), then bumped to `3.4.0` anyway since it's
      a safe, patch-level fix. Verified before shipping: encode/decode
      round-trip works with the new version, full backend suite still 60
      passed / 0 failed, and the full `app.api.router` still imports clean
      (302 routes) despite a pip dependency-resolver warning about a
      transitive `pyasn1` version conflict (checked — non-fatal, nothing
      actually broke). The other critical (**`vitest`**, arbitrary file
      read when its UI server is network-exposed on Windows) is a
      dev-only test-tool dependency, low practical risk here, and its fix
      is a major version bump (1.x → 3.x) that could break the test setup —
      deliberately **not** bumped blindly; flagged for a dedicated pass
      with time to verify the test suite still runs after upgrading,
      rather than risking it inside this item.
      **137 more alerts remain untriaged** (69 high / 57 medium / 12 low) —
      opening `dependabot_security_updates` will start proposing PRs for
      these automatically going forward; reviewing the existing backlog is
      real follow-up work, not something to rubber-stamp in bulk.

### 20. Legal & governance — `todo`
Engage an Indian data-protection lawyer (role classification, DPA, privacy policy, terms,
research-exemption position — do not market Section 17(2)(b) research exemption as a
blanket cover). Publish a named Grievance Officer with contact + response timelines.
Maintain a Record of Processing Activities. Run a DPIA on AI features + audio recording.
Write internal policies (access control, incident response, retention, acceptable use,
vendor management, secure development) and train staff.

### 21. AI feature controls — `in-progress` (most already covered by item 1, 2 new labels added)
- [x] **Most of this item's requirements were already satisfied by item 1's
      work earlier this session** — checked before assuming anything was
      missing: send-only-aggregated/pseudonymised data (item 1's PII
      stripping + `ai_sanitize.py` dummy-data work), per-org opt-in
      (`Tenant.ai_config`), provider disclosure (`GET /ai/sub-processor`),
      BYO key. Not duplicating that write-up here — see item 1.
- [x] **Model-call logging (tenant, purpose, provider — no personal
      content) — already fully built, verified not assumed.** Checked
      `AiUsageLog` (`backend/app/models/ai_usage_log.py`): `tenant_id`,
      `user_id`, `feature`, `provider`, `model`, token counts,
      success/error — **structurally cannot log personal content**, since
      there's no free-text/content column to put it in. Confirmed it's
      actually written (not dead code, unlike two other things found
      earlier this session) — used in `ai_service.py`.
- [x] **"AI-generated draft — verify before use" labeling — done
      2026-09-19.** Genuinely didn't exist anywhere in the UI (only a
      marketing-copy mention, not a real label next to real AI output).
      Added a visible warning banner directly above the rendered AI output
      in both places a full AI report is shown: `AiReportModal.tsx` (the
      dashboard's quick single-form report) and `FgWriter.tsx` (the main
      report-writing tool, above the editable draft).
- [x] **"Never use AI output to decide about an individual respondent" —
      checked, not violated.** Traced every AI-suggestion endpoint
      (`suggest_skip_logic`, DataCleaner's `ai_correct`): all return
      `{suggestions: [...]}` for a human to review and explicitly accept —
      nothing auto-applies an AI decision to a specific respondent's data
      or status. `ai_correct` additionally has a hard 400 refusal (from
      item 1) if a PII-shaped column is selected at all.
- [ ] **Real gap, not fixed: "show the underlying table alongside" AI
      output.** Partially true by architecture (FgWriter's Narrate flow
      requires selecting existing tabulation tables first, which the user
      has already seen in the Tabulator tab) but the source table isn't
      shown *alongside* the generated narrative in the same view — a real,
      if minor, UX gap, not built this pass.
- [ ] **Real gap, not fixed: proactive prompt-injection defense.**
      `DataCleaner`'s `ai_correct` interpolates real (non-PII-column) row
      values — which can include respondent free-text — directly into an
      f-string prompt with no escaping or sandboxing. The blast radius is
      already bounded by architecture (every AI suggestion requires human
      review before anything is applied — see above), so a successful
      injection can't directly mutate data or trigger an action, but
      there's no input-side defense (detecting/neutralizing injection
      attempts before they reach the model). Flagged honestly rather than
      claimed as "guarded."
- [ ] **Real gap, not fixed: "India-only mode."** BYO lets an org pick
      among OpenAI/Anthropic/Gemini/DeepSeek — all foreign providers. A
      real "India-only" toggle would currently mean "disable AI
      entirely," since no India-hosted model is integrated — this needs an
      actual product/vendor decision (integrating a domestic model
      provider) before the toggle would mean anything, not just a
      config flag.
- [ ] **Not done: DPAs with model providers.** Legal/contractual work, not
      code — tracked alongside item 14's other contract work.
- [ ] **Verified:** `npx tsc --noEmit` clean; `npm run build` succeeds. No
      backend changes this item.

### 22. Sub-processors & integrations — `in-progress` (Sheets-sync safeguards done)
- [x] **Google Sheets treated as an export — done 2026-09-19.** `exclude_identifiers`
      added to `forms.sheets_sync_config` (default `True` — opt-out, not
      opt-in), reusing the same `is_identifier` flag + `pii_redact.redact_row()`
      already used for AI-call protection, so identifier fields (name,
      phone, etc.) never leave via Sheets sync unless an admin explicitly
      turns the exclusion off. Redaction happens inside `sync_submission()`
      itself, so `bulk_sync_submissions()` (used by platform migration
      imports) inherits it automatically rather than needing a second copy.
      New red warning banner in `IntegrationsPanel.tsx`'s Sheets section:
      "This is a data export" — explicit that FieldGovern's erasure/
      retention/audit tools don't reach a synced row once it's in the
      Sheet. Per-tenant disable already existed (the existing enabled
      toggle) — nothing new needed there.
      3 pytest cases (`backend/tests/test_sheets_sync_redaction.py`):
      excluded by default, explicitly disabled, explicit true matches
      default. Full backend suite: 72 passed / 79 skipped / 0 failed.
- [ ] **Not done: full sub-processor list with purpose + country.** Tracked
      together with item 14's DPA/sub-processor work — see that item.
- [ ] **Not done: notify customers before adding a new sub-processor, with
      a right to object.** This is a process commitment (a standing policy
      about *future* changes), not something expressible in code today.

### 23. Retention & deletion — `in-progress` (per-form policy + auto-expiry built)
- [x] **Per-form retention setting — done 2026-09-19.** New
      `forms.retention_days` column (migration `0061`, nullable — `NULL`
      means no policy, preserving current behavior for every existing
      form). Editable in the Form Builder's settings panel, alongside the
      other DPDP settings added in item 5 — separate save action from the
      schema save, since it's a real `Form` column, not part of
      `json_schema`.
- [x] **Automatic anonymisation at expiry — done, reuses the same erasure
      core again.** New `backend/app/services/retention.py` +
      a daily scheduler job (04:15 UTC, matching the existing APScheduler
      convention in `core/scheduler.py`). `action=erase` here calls the
      **same** `_erase_submission_row()` helper as anonymize (master_admin),
      consent withdrawal (org_admin), and data-rights erasure — the 4th
      call site now sharing one implementation, with its own audit action
      label (`retention_expiry_anonymized`) so it stays distinguishable
      from the other three in the log.
- [x] **Reminder before expiry — done.** In-app notification (reusing the
      existing `create_notification()` inbox helper, not a new
      notification path) to every `org_admin` in the tenant, fired once —
      exactly 7 days before a submission's retention date, computed by
      whole-day comparison so a job running a few minutes late doesn't
      miss the window.
- [x] **Verified:** the two pure date-math functions
      (`is_past_retention`, `is_reminder_due`) are unit-testable without a
      DB — 9 pytest cases (`backend/tests/test_retention.py`) cover the
      exact boundary day (not yet past at exactly N days old), the
      reminder firing exactly once at the threshold and not before/after,
      an already-anonymized submission never re-triggering a reminder, and
      missing-timestamp safety. All 9 pass. Full backend suite: 69 passed
      (up from 60) / 79 skipped / 0 failed — `py_compile` clean;
      `app.api.router` + `core.scheduler` both actually imported, no
      runtime errors. `npx tsc --noEmit` clean; `npm run build` succeeds
      (65 precached entries).
- [ ] **Not done: contract-end deletion certificate.** Tracked together
      with item 14's DPA/deletion-certificate work — see that item.
- [ ] **Not done: deleting enumerator location traces once no longer
      needed for QC.** No specific "GPS trace expiry, independent of the
      submission's own retention policy" mechanism exists — exact GPS
      currently lives as long as its parent submission does. A real,
      separate follow-up if location data needs a shorter/different
      retention window than the rest of the response.

### 24. Trust Centre page — `done` (mostly already existed under other pages, indexed rather than duplicated)
- [x] **Checked before building — most of this already existed, just wasn't
      tied together.** `security.html` (security overview),
      `dpdp-compliance.html` (DPDP feature mapping), and `dpa-template.html`
      (a full, already-public 11-section DPA) were all live already.
      `website/status.html` exists but is an internal deploy/CI dashboard
      (`noindex,nofollow`, shows GitHub Actions runs and commits) — not
      appropriate to link publicly as a customer-facing uptime page.
- [x] **New `website/trust.html` — done 2026-09-19.** A real index/hub page
      (not a duplicate) at `/trust.html`: a live public health check
      (fetches `/health` directly, shows Operational/Down — not the
      internal CI dashboard), cards linking to the 4 real pages above, and
      an "at a glance" summary table describing actual built mechanisms
      (tenant isolation, audit chain, consent, data-rights workflow,
      breach plan) rather than generic claims.
- [x] **Fixed a real incompleteness while in the area:**
      `dpdp-compliance.html`'s sub-processor table only listed Hosting +
      AI — extended it to match the comprehensive list built for item 14
      (`deploy/SUB_PROCESSORS.md`): Google Sheets/Drive/OAuth, SMS/WhatsApp/
      Telegram, Razorpay, Sentry, and PostHog. Added a `#subprocessors`
      anchor + cross-links between `dpdp-compliance.html` and the new
      `trust.html` in both directions.
- [x] **Verified:** basic tag-balance check (div/section/nav/footer/
      table/tr/script open-vs-close counts) on both the new page and the
      edited existing one — all matched. Could not visually render-test
      (no browser available this session) — flagged rather than claimed.

### 25. Product roadmap (competitive gaps vs. the 17 other India-built platforms) — `in-progress` (triaged — most items already exist)
- [x] **Triage done 2026-09-18 — checked the actual codebase against every
      named gap before assuming any needed building.** Result: 4 of the
      "gaps" this list named **already exist and are marketing/documentation
      gaps, not product gaps**:
  - **XLSForm import/export** — fully built.
    `backend/app/api/routes/migration/xlsform_parser.py` +
    `xlsform_serializer.py`, wired to `/xlsform/parse`, `/xlsform/save`,
    `/xlsform/serialize`, `/xlsform/export/{form_id}`. Kobo, SurveyCTO, and
    ODK Central platform-import clients exist too
    (`migration/platform_clients.py`).
  - **Indicator framework / logframe** — fully built.
    `backend/app/models/results_framework.py` (`LogframeLevel`,
    `Indicator`, `IndicatorValue`) + full CRUD, auto-compute, and an
    Indicator Tracking Table export (`GET /programs/{id}/itt/xlsx`) in
    `backend/app/api/routes/results.py`.
  - **GIS / maps** — built. `frontend/src/map/FieldMapPage.tsx`, Leaflet +
    react-leaflet, live at `/map` in the nav.
  - **Longitudinal case management (panel studies)** — built. Wave
    tracking, panel-study toggle, and an attrition report
    (`GET /programs/{id}/attrition`) already exist in `field_govern.py`.
      **None of this was known/flagged before this triage** — worth telling
      whoever owns product marketing, since these are real differentiators
      already shipped, not roadmap items.
- [ ] **Real gap: full UI localisation.** Partial, not full — respondent-
      facing form-taking (`FormRenderer`, the consent notice) IS localized
      (`en`/`hi`/`kn`/`te`) via `LanguageContext`/`getLocalizedLabel`. The
      staff-facing admin UI chrome is not: `Sidebar.tsx` has 2 references to
      the language system, `TopNav.tsx` has zero. `react-i18next` is a
      listed dependency but not wired up for the admin/staff surface.
- [ ] **Real gap: CSR reporting templates** (CSR-2/BRSR/SDG format
      exports) — zero matches anywhere in the codebase, genuinely not built.
- [ ] **Real gap: Dalgo / data-warehouse connector** — not built.
- [ ] **Real gap: native Android app** — this is a PWA; no native app shell
      exists.
- [ ] **Real gap: SSO/SCIM/on-premise option** — SSO is also named under
      item 16; on-premise deployability was not specifically checked this
      pass, flagged for follow-up rather than assumed either way.
- [ ] **Real gap: WCAG 2.1 AA / GIGW accessibility** — no accessibility
      audit has been run against either the respondent-facing collection
      flow or the admin UI; not something to claim compliant without
      actually testing it (screen reader pass, keyboard-only navigation,
      contrast ratios).

---

## Not tracked here (informational only, no action needed)
- §3 Market landscape (18-platform comparison table) and §4.4 (FieldGovern vs. each
  competitor) — reference material, re-derive from the source doc if needed for future
  marketing copy, not an engineering task.
- §9 Pre-launch DPDP readiness checklist and §10 "Questions buyers will ask" — these are
  restatements of items 1–24 above in checklist/FAQ form; use them as the acceptance
  criteria when closing out each numbered item, not as separate work.
