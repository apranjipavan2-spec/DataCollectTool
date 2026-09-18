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

### 1. AI cross-border data flow — `in-progress`
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
- [ ] Scrub the old hardcoded values from git history (destructive — rewrites
      history, needs a force-push; requires explicit go-ahead before doing this).
- [ ] Remove/rotate any other seed scripts, dev env templates from the public
      branch; decide public vs private + add explicit licence/SECURITY.md
      (business decision, not mine to make).
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
      answers above; the big compliance-mapping table on `dpdp-compliance.html`
      still says "Implemented" for tenant isolation AND children's-data guardian
      consent, neither of which is actually true yet (items 2 and 13).
      **Explicit owner decision, 2026-09-18: do NOT touch this further.** Softening
      more marketing copy right now would hurt positioning/ranking for gaps we're
      actively closing anyway — the fix is to build items 2 and 13 for real (so
      the claim becomes true), not to keep walking the copy back. Revisit this
      specific table once those two items ship.

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

### 6. Per-purpose consent — `todo`
Separate consent items: survey answers / audio / photo / GPS / follow-up contact. Block
the matching question types if refused. Store notice-version ID, language, consent items,
timestamp, enumerator ID, device ID with each submission. Support oral consent +
enumerator attestation (optional audio proof).

### 7. Consent withdrawal — `todo`
Respondent reference code (printed slip or SMS). Withdrawal as easy as giving consent —
an admin action via the customer's grievance channel that stops processing and triggers
erasure/anonymisation.

### 8. Data-principal rights workflow — `todo`
Log → verify identity → search respondent across all forms/waves → act (export/correct/
erase) → close with audit record. SLA tracking (aim 30 days, outer limit 90 days per
Rules) with overdue alerts. Machine-readable export. Nomination support (nominee acts if
respondent dies/incapacitated).

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

### 10. Encryption at rest — `todo`
Currently TLS + bcrypt only (no data-at-rest encryption described). Add: disk + object
storage (photos/audio) + backup encryption via a managed key service in an Indian region;
field-level (envelope) encryption for direct identifiers (name, phone, Aadhaar-like IDs,
exact GPS) — never store full Aadhaar numbers. TLS 1.2+, HSTS, secure cookies, scheduled
key/secret rotation + rotation on staff exit.

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

### 12. Breach response — `todo`
Written incident-response plan: roles, severity levels, contact lists. Timelines: CERT-In
report ≤6h, customer notice ≤24h (so they can meet their own obligations), Board detailed
report ≤72h. Pre-drafted notification templates, forensic log preservation, tabletop
exercise twice a year.

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

### 14. Processor contract — `todo`
Publish a DPA template, sub-processor list, and a deletion-certificate process for when a
customer's contract ends.

### 15. Device / offline security (PWA) — `todo`
`navigator.storage.persist()` + quota check on start, warn on low/denied storage. Encrypt
on-device submissions via Web Crypto keyed from an enumerator PIN; clear local copies
after confirmed sync. Auto-lock after inactivity; server-side device de-registration so a
lost phone can't sync/decrypt further. Visible "unsynced items" counter that blocks
logout/cache-clear while unsynced. iOS Safari can evict storage — require Add-to-
Home-Screen for iOS or recommend Android. Test matrix: low-end Android, multi-day
offline, low storage, app kill, browser update, clock changes, interrupted sync, duplicate
resubmission (note: duplicate-resubmission UX already has a guard — see `tasks/todo.md`
"Resubmit cooldown" entry — reuse/extend rather than rebuild).

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
- [ ] Make MFA mandatory for admins/supervisors (currently opt-in per user).
- [ ] SSO (SAML/OIDC) for enterprise/government customers.
- [ ] Short-lived access tokens + refresh-token rotation + server-side revocation;
      session timeouts; login rate limiting + lockout.
- [ ] Least-privilege roles including an analysis-only role without identifier
      access. FieldGovern staff access to customer data only with customer
      approval, time-limited, and logged.

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

### 19. Secure development — `todo`
Dependency/container/secret scanning + SAST in CI. Code review on every change. Separate
dev/staging/prod with no real personal data outside prod. Publish `security.txt`
vulnerability-disclosure policy.

### 20. Legal & governance — `todo`
Engage an Indian data-protection lawyer (role classification, DPA, privacy policy, terms,
research-exemption position — do not market Section 17(2)(b) research exemption as a
blanket cover). Publish a named Grievance Officer with contact + response timelines.
Maintain a Record of Processing Activities. Run a DPIA on AI features + audio recording.
Write internal policies (access control, incident response, retention, acceptable use,
vendor management, secure development) and train staff.

### 21. AI feature controls — `todo`
Send only aggregated/pseudonymised data to models. Per-org opt-in with provider +
processing-country disclosure; an "India-only" mode that disables foreign model calls.
DPAs with model providers (no training on customer data, retention period confirmed,
zero-data-retention where available). Label every AI output "AI-generated draft — verify
before use," show the underlying table alongside it, never use AI output to decide about
an individual respondent. Guard against prompt injection from respondent free-text. Log
every model call (tenant, purpose, data categories, provider) without logging personal
content.

### 22. Sub-processors & integrations — `todo`
Publish a full sub-processor list (hosting, AI providers, Google Sheets/Drive,
WhatsApp/Meta, email, SMS, payment gateway, error tracking, analytics) with purpose +
country. Notify customers before adding a new one, with a right to object. Treat Google
Sheets sync as an export that leaves FieldGovern's control: warn admins, allow disabling
per tenant, exclude identifier fields by default.

### 23. Retention & deletion — `todo`
Per-form retention setting with automatic deletion/anonymisation at expiry + a reminder
before it happens. On contract end: data export, deletion within an agreed period, and a
deletion certificate. Delete enumerator location traces once no longer needed for QC.

### 24. Trust Centre page — `todo`
Public page: security overview, sub-processor list, DPA, DPDP feature mapping, uptime
status.

### 25. Product roadmap (competitive gaps vs. the 17 other India-built platforms) — `todo`
Longitudinal case management (Avni/SocialCops gap), XLSForm import/export (ODK-ecosystem
migration), GIS layers/maps (TechCSR gap), indicator framework/logframe (Dhwani RIS/
TolaData gap), CSR reporting templates (CSR-2/BRSR/SDG — iAmpact/Goodera gap),
Dalgo/data-warehouse connector, native Android app, SSO/SCIM/on-premise option, full UI
localisation (Hindi/Kannada/Telugu first), WCAG 2.1 AA / GIGW accessibility.

---

## Not tracked here (informational only, no action needed)
- §3 Market landscape (18-platform comparison table) and §4.4 (FieldGovern vs. each
  competitor) — reference material, re-derive from the source doc if needed for future
  marketing copy, not an engineering task.
- §9 Pre-launch DPDP readiness checklist and §10 "Questions buyers will ask" — these are
  restatements of items 1–24 above in checklist/FAQ form; use them as the acceptance
  criteria when closing out each numbered item, not as separate work.
