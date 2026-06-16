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

## L013 — CSP needs 'wasm-unsafe-eval' for the OPFS/wa-sqlite storage layer
Admins saw "0 forms" on /collect while the dashboard showed 16. Root cause: the CSP `script-src` (in `backend/app/main.py` SecurityHeadersMiddleware) lacked `'wasm-unsafe-eval'`, so the wa-sqlite WebAssembly module aborted (`CompileError: ... 'unsafe-eval' is not an allowed source`). FieldApp.modern's loadForms calls `getStorage()` BEFORE fetching forms; the abort threw at the top of the outer try and the form fetch never ran — the catch swallowed it, leaving an empty list. The dashboard was fine because it hits `/forms/` directly without the WASM storage layer. Fixes: (1) add `'wasm-unsafe-eval'` to CSP script-src — it permits WASM compilation only, NOT general eval(), so it's far narrower/safer than `'unsafe-eval'`; (2) isolate storage init in collect so a storage failure can't block the network form fetch. Lesson: any page that depends on the OPFS/wa-sqlite worker must not let storage init gate network data, and CSP changes must account for WASM. The CSP is set ONLY in main.py (not nginx).
