# Lessons — Mistakes & Patterns to Avoid

Most of these are also enforced as numbered rules in `CLAUDE.md`. Keep this file for the "why" — the context that explains the rule.

## L001 — Patch `seed_dev.py` when adding migrations
Every new alembic migration must have a matching `ADD COLUMN IF NOT EXISTS` patch in `seed_dev.py._PATCHES` AND a detection line in `wait_and_stamp.py`. Production DBs may have been set up without alembic tracking; belt-and-suspenders patches ensure columns exist even if alembic silently fails.

## L002 — Register new routers in `router.py`
A new `routes/foo.py` does nothing until imported + `include_router`'d in `app/api/router.py`. `field_govern.py` once shipped with all endpoints returning 404 because of this.

## L003 — User dependency is a dict, not an ORM model
`get_current_user` returns `{"sub": user_id, "tenant_id": ..., "role": ...}`. Use `user["sub"]` (not `user["id"]` — doesn't exist), `user["tenant_id"]`, `user["role"]`.

## L004 — localStorage keys need both `programId` AND `userId` for per-user caches
Pattern: `fg_tabs_{programId}`, `fg_last_form_cache_{userId}`. Without namespacing, data bleeds across programs or across users on shared devices.

## L005 — Nav items need both `navigation.ts` AND `<Route>` in `App.tsx`
Adding to `getNavItems()` without a route → blank page. Role-restricted nav also needs a role-guard wrapping the route — otherwise users can navigate by typing the URL directly.

## L006 — `TopNav` breadcrumbs use `path`, not `href`
Component signature is `{ label: string; path?: string }`. `href` is silently ignored → dead links.

## L007 — `seed_dev.py` fast-path skips patches on warm restart — intentional
The seed exits early if `Demo Org` exists, but schema patches run BEFORE that check, so they always apply. Don't "fix" the early-exit ordering.

## L008 — SQLAlchemy JSONB mutations need `flag_modified`
In-place mutation (`row.value["key"] = val`) is a silent no-op — SQLAlchemy tracks object identity, not deep dict content. Always:
```python
from sqlalchemy.orm.attributes import flag_modified
flag_modified(row, "column_name")
```

## L009 — Use `_ensure_table(db)` for ad-hoc feature tables
For small feature tables (comments, inbox), `CREATE TABLE IF NOT EXISTS` at the start of each endpoint avoids per-feature migrations. Idempotent, production-safe. Don't use this for tables with FK constraints to core models — those need alembic.

## L010 — Leaflet via CDN, not npm
Inject `<link>`/`<script>` in a `useEffect` only on the map page. Avoids ~150KB in the main bundle for a supervisor-only feature. Guard with `if (!document.getElementById('leaflet-js'))` to prevent double-inject; use `script.onload = initMap`. *(Note: CLAUDE.md rule 10 says npm-only — that rule was added after this lesson and supersedes it for new map features.)*

## L011 — master_admin token = empty data in embedded tools
master_admin's JWT carries the platform tenant (e.g. "FieldGovern Platform"), which has zero programs/forms/submissions by design (tenant isolation, see deps.py). When tools (datacleaner, tableforge, analyzer) launch with a master_admin token, `/api/v1/programs/` returns `200 []` and a pre-passed `program_id` 404s — because it lives under a real org tenant. Cross-tenant view needs the `X-Tenant-ID` override header, which the tool proxies don't forward. Fix UX by surfacing the empty/error state instead of a silent blank dropdown; for real data, launch the tool while signed in to the org that owns the programs.

## L012 — Tool identity must come from the verified JWT, never client headers
TableForge's "recent projects" scoped data on `X-User-Id` / `X-User-Role` headers, fed from URL params or **stale localStorage** (`tf_user_id`/`tf_user_role`). Two holes: (1) once a super_admin used the analyzer on a browser, the cached `master_admin` role leaked their projects to the next user on that browser; (2) anyone could append `?user_role=master_admin` to read/rename/delete every user's projects. Fix: backend `verify_fg_identity()` resolves the token against FG `/api/v1/users/me` (prefer `FG_INTERNAL_URL` env as the trusted authority, never the client-supplied base); endpoints take a `current_identity` dependency; frontend `getUserHeaders()` sends `Authorization: Bearer <token>` only and decodes role from the token payload for UI hints (backend re-verifies). Rule: any embedded tool that scopes data per-user MUST derive id/role from a verified token, not headers/params/localStorage. The datacleaner was already clean (only token-verified FG calls). See [[L011]].

**Identity-authority hardening:** `_resolve_fg_base()` must NEVER fall back to a client-supplied base URL for token verification — the client also supplies the token, so trusting its base = full authz bypass (point verification at an attacker server that returns `role: master_admin`). It requires a server-configured `FG_INTERNAL_URL`/`FG_PUBLIC_URL` and fails closed (returns "") otherwise; optional `FG_ALLOWED_VERIFY_HOSTS` allowlist covers dev/multi-tenant. Prod already sets `FG_INTERNAL_URL: http://app:8000`.

## L013 — CSP needs 'wasm-unsafe-eval' for the OPFS/wa-sqlite storage layer
Admins saw "0 forms" on /collect while the dashboard showed 16. Root cause: the CSP `script-src` (in `backend/app/main.py` SecurityHeadersMiddleware) lacked `'wasm-unsafe-eval'`, so the wa-sqlite WebAssembly module aborted (`CompileError: ... 'unsafe-eval' is not an allowed source`). FieldApp.modern's loadForms calls `getStorage()` BEFORE fetching forms; the abort threw at the top of the outer try and the form fetch never ran — the catch swallowed it, leaving an empty list. The dashboard was fine because it hits `/forms/` directly without the WASM storage layer. Fixes: (1) add `'wasm-unsafe-eval'` to CSP script-src — it permits WASM compilation only, NOT general eval(), so it's far narrower/safer than `'unsafe-eval'`; (2) isolate storage init in collect so a storage failure can't block the network form fetch. Lesson: any page that depends on the OPFS/wa-sqlite worker must not let storage init gate network data, and CSP changes must account for WASM. The CSP is set ONLY in main.py (not nginx).

## L014 — TableForge project endpoints taking a raw `path` must re-check ownership
The TableForge-local project store (`tools/tableforge/backend/routers/projects.py`) is one disk volume shared across all tenants, keyed by FG user-id. `save/list/load/rename/delete` correctly gate on `is_super_admin OR path under caller's own get_user_projects_dir`, but `versions`, `diff`, `rollback`, `reload-file`, and `batch` accepted a raw path/config with NO identity check. Since paths are predictable (`projects/{fg_user_id}/{name}.tableforge`) and the user-id isn't secret, any authenticated user of any tenant could read another tenant's project tables (versions/diff), overwrite them (rollback), or read arbitrary JSON/data files (versions/reload-file = arbitrary-file-read). Fix: extracted `require_project_access(path, ident)` helper and applied it to all path-taking endpoints; reload-file additionally confines reads to CACHE_DIR/PROJECTS_DIR. Lesson: the DB-backed stores (`user_tool_projects.py`, `shared_files.py`) enforce tenant scoping per-query, but tableforge has no blanket auth on `include_router` — EVERY endpoint that takes a path is individually responsible for the ownership guard.

## L015 — TableForge Import menu vs "recent sessions" read different stores
The home "recent sessions" list reads the FieldGovern per-user store (`/api/v1/tool-projects/`, auth'd by token, same as `fgListUserProjects`), but the Import dropdown's "Recent Projects" read the TableForge-local disk store (`GET /api/projects`). On accounts that only ever saved to their FG account, the dropdown showed "No saved projects yet" while the screen showed projects — same data conceptually, two sources. Fix: pointed `ImportDropdownBtn` at `fgListUserProjects` (threaded `fgContext` + `onLoadProject` through RibbonBar→HomeRibbon). Also: project removal is now soft-archive — `DELETE /tool-projects/{id}` sets `archived_at` (migration 0044) instead of deleting; `list` takes `?archived=` and there's a `POST /{id}/restore`. UI exposes an "Archive folder" in both the Import dropdown and ProjectManager. Lesson: when two UI surfaces claim to show "your projects," confirm they hit the same backend store before assuming a data bug.

## L016 — TableForge "% Total" (pct_grand) denominator double-counted the margin row
The pivot `pct_grand` show_as/combo computed its denominator as `pivot_df[data_cols].values.sum()`. `data_cols` correctly excludes the Grand Total *column*, but the sum still spanned every *row* including the Grand Total margin row — so the base was 2× the true total and every cell read half its real percentage (a 205 total showed as 50%). Fix (`tabulate.py` ~1067): mask out rows whose label contains "Grand Total"/"Subtotal" before summing, and use `np.nansum` so sparse/empty pivot cells (NaN) don't poison the total. Grand Total cell now reads 100%; rows and columns each sum to 100%. Lesson: any "% of total" base built from a pivot that carries margins must exclude BOTH the margin row and margin column, not just the column.

## L017 — TableForge dropped "None" multi-choice answers as if missing
The literal string "None" was included in the missing-value sets used during multi-choice explode (`_nan_strs`) and pivot blank-cleanup (`_bad_strs` and an inline tuple) in `tabulate.py`. In surveys "None" (e.g. "None of the above") is a real answer choice, so respondents who selected it were silently excluded from the table — the column never appeared. Fix: removed 'None' (and 'null') from those string sets; genuine missing values are still caught by `pd.isna`, and serialization artifacts (nan/NaN/NaT/<NA>) still count as blank. Also renamed the serial-number column header from "#" to "SN" in LivePreview + all export paths. Lesson: never put real categorical answer labels ("None", "Other", "N/A" can be legitimate) into a missing-value string blocklist; rely on actual-NaN detection, and reserve string matching for true serialization junk.

## L018 — XLSForm/platform import "Save as Draft" always 500'd (dict-vs-attr on user dep)
`backend/app/api/routes/migration/router.py` accessed `user.tenant_id` and `user.id` as attributes, but `require_org_admin` returns the JWT payload **dict** (see CLAUDE.md rule #4). Every save path (`/xlsform/save`, kobo/surveycto/odk import) raised `AttributeError` → 500 the moment it tried to build the Form. The `/xlsform/parse` endpoint never touches those keys, so parse+preview worked perfectly while save silently died — exact symptom a trial user reported ("209-field preview correct, draft never appears"). Fix: `user["tenant_id"]` (×6) and `enumerator_id=user["sub"]` (the dict has `sub`, not `id`). Also surfaced backend error detail in `MigrationPage.tsx` (`err.response?.data?.detail`) so a failed save shows a real reason instead of axios's "Request failed with status code 500". Lesson: this codebase's `user` dep is ALWAYS a dict — never `user.attr`. Any new route file is the place this regresses; grep new routes for `user\.(tenant_id|id|sub|role)`.

## L019 — Phone lookup must be normalized on BOTH create and login
`e2fc62c` normalized phones on user-create (stored `+91XXXXXXXXXX`) but `login()` (`auth.py`) matched `User.phone == raw_input`, so typing `9752546653` never matched stored `+919752546653` → "Invalid credentials" for supervisors created after the fix. Fix: normalize the login lookup and match either form (`or_(User.phone==lookup, User.phone==normalized, ...)`). Lesson: whenever phone is a lookup key, normalize at BOTH the write and the read boundary — storage and lookup must share one canonical form, or half your users silently can't log in.

## L020 — create_user dup-check is global; roster list is tenant+active-scoped
`create_user` (`users.py`) blocks on `User.phone == phone` globally (correct — login resolves phone globally so phones must be globally unique), but `list_users` filters `tenant_id == mine AND is_active == True`. Net effect: a **deactivated** same-tenant user shows "Phone already registered" yet is invisible in the roster — a dead-end the admin can't self-resolve. Fix: on create, if the phone belongs to a deactivated user in the SAME tenant, reactivate + update it instead of 400. NOTE: does not cover a phone owned by a DIFFERENT tenant — that still 400s by design and needs a DB-level check to resolve. Lesson: a global uniqueness guard paired with a scoped list view produces "exists but invisible" bugs; make the create path reactivate what the list path hides.

## L021 — Deploy stamping only self-healed an empty alembic_version, not a stale one
`wait_and_stamp.py` reconciled `alembic_version` only when it was missing/empty. A VPS DB whose schema was advanced by hand (`submissions.schedule_id` added manually) but left tracked at an older rev sailed through every deploy as a no-op — until head advanced to `0045`. Then `alembic upgrade head` tried `0044->0045` against a version row that didn't match and died with "expected to match one row … 0 found", failing the whole deploy (`dc84f59` fixed it). Fix: run the schema-detection ladder whenever `tenants` exists and forward-correct the stamp when the recorded rev is strictly behind the detected one — forward-only (never re-runs applied migrations), no-op on non-numeric revs. Lesson: a "stamp only when untracked" reconciler can't heal a DB that's tracked-but-stale; make it reconcile to schema-truth on every deploy, but forward-only so it can never re-run an old, possibly non-idempotent migration.

## L022 — Public survey link had no local persistence; one failed POST lost the whole response
`PublicSurveyPage.tsx` wired `onSave={async () => {}}` (a no-op) and POSTed directly on submit. A respondent completed all 171 questions of the Sangwari Endline survey; the single final POST failed on a weak connection ("Submission failed. Please check your connection"), and because nothing was ever persisted, all answers lived only in React state — a page close/reload would have lost everything. The offline PWA field-app (`FieldApp.modern.tsx`) has a full IndexedDB outbox + retry; the public web-link path had none. Fix: `surveyStore.ts` — a dedicated Dexie DB (`fieldgovern-survey`, separate from the enumerator `fieldgovern` store) that autosaves the in-progress draft on every change (restored on reopen) and, on submit, enqueues the completed response locally BEFORE uploading, deleting it only on a confirmed 2xx; retries on mount, `online` event, and a 15s interval; requests StorageManager persistence. Success screen shows "saved on this device, will upload automatically" when still pending. Lesson: any data-entry surface — including anonymous/public ones with no login — must persist locally before it touches the network; "it's just a public link" is not a reason to skip the outbox. Data is precious.
