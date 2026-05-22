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
