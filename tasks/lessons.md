# Lessons — Mistakes & Patterns to Avoid

## L001 — Always patch seed_dev.py when adding migrations
**Pattern:** Each new alembic migration (0019+) MUST have a matching `ALTER TABLE … ADD COLUMN IF NOT EXISTS` patch in `seed_dev.py` AND a detection line in `wait_and_stamp.py`.  
**Why:** Production DBs may have been set up without alembic tracking; belt-and-suspenders patches ensure columns exist even if alembic silently fails.  
**How to apply:** When writing a migration, immediately add the patch to `_PATCHES` list and a `col_exists` / `table_exists` check in `wait_and_stamp.py`.

## L002 — Register new routers in router.py
**Pattern:** A new `routes/foo.py` file does nothing until imported and `include_router`'d in `app/api/router.py`.  
**Why:** `field_govern.py` was created but not registered — all its endpoints returned 404.  
**How to apply:** After creating any new route file, immediately add it to router.py.

## L003 — field_govern.py: `require_supervisor` uses `user["tenant_id"]` not `user.tenant_id`
**Pattern:** The user dependency returns a dict (`{"user_id": ..., "tenant_id": ..., "role": ...}`), not an ORM model. Always use `user["tenant_id"]`, `user["role"]`.  
**Why:** Mixing dict access with attribute access causes `KeyError` at runtime.

## L004 — localStorage keys must be namespaced by programId
**Pattern:** `fg_tabs_{programId}`, `fg_reports_{programId}` — always include entity ID in the key.  
**Why:** Without namespacing, data from one program bleeds into another for the same user.

## L005 — Navigation items require both navigation.ts AND App.tsx route
**Pattern:** Adding a nav item to `getNavItems()` without a matching `<Route>` in App.tsx causes a blank page.  
**How to apply:** Always add the route in App.tsx immediately after adding to navigation.ts.

## L006 — TopNav breadcrumbs use `path` not `href`
**Pattern:** The `TopNav` component accepts `{ label: string; path?: string }` — NOT `href`.  
**Why:** Used `href` initially which caused dead breadcrumb links (silently ignored).

## L008 — SQLAlchemy JSONB mutations need flag_modified
**Pattern:** When updating a JSONB column in-place (`row.value["key"] = val`), SQLAlchemy does NOT detect the change. Must call `flag_modified(row, "value")` before `db.commit()`.  
**Why:** SQLAlchemy tracks object identity, not deep dict content. Silent no-op otherwise.  
**How to apply:** After any in-place JSONB dict mutation, always call `from sqlalchemy.orm.attributes import flag_modified; flag_modified(row, "column_name")`.

## L009 — _ensure_table() for ad-hoc tables avoids migration overhead
**Pattern:** For new feature tables (comments, inbox), use `_ensure_table(db)` with raw `CREATE TABLE IF NOT EXISTS` SQL called at the start of each endpoint.  
**Why:** Avoids creating a migration for every small feature table; safe for idempotent re-runs; production-compatible.  
**Tradeoff:** No alembic tracking — fine for feature tables, not for tables with FK constraints to core models.

## L010 — Leaflet loaded from CDN, not npm, for optional map features
**Pattern:** Dynamically inject `<link>` and `<script>` for Leaflet CSS/JS in a `useEffect` only when the map page loads.  
**Why:** Avoids adding ~150KB to the main bundle for a feature only supervisors use. CDN load is cached after first visit.  
**How to apply:** Check `window.L` before injecting; use `script.onload = initMap` callback; guard with `if (!document.getElementById('leaflet-js'))` to prevent double-inject.

## L007 — seed_dev.py fast-path skips patches on warm restart
**Pattern:** The seed exits early if `Demo Org` tenant exists. Schema patches run BEFORE that check, so they always apply.  
**Why:** This is intentional — patches must always run to handle incremental column additions on existing DBs.
