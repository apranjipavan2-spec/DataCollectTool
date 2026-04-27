# Lazy Loading & Performance Architecture Plan

**Goal:** Backend computes all stats accurately from full dataset. Frontend fetches data only when the user explicitly requests it via a "Load Data" button. No hardcoded row limits on stats. Display lists are paginated and slim. Scales to 100k+ submissions without degradation.

**Status:** Planning — not yet implemented  
**Priority:** High (platform slowdown already visible at 545 submissions)

---

## Core Principle

| Layer | Rule |
|---|---|
| Stats (counts, scores, names) | Always computed server-side from full dataset — never sampled or trimmed |
| List display | Paginated, slim (no `data_json`), server-side — 50 rows at a time |
| Full detail | Fetched on demand only when user opens a record |
| Page load | Never auto-fetches row data — shows summary + Load button |

---

## Tier 1 — Backend: Summary Endpoints

New endpoints that return accurate stats with zero row fetching. All use `COUNT`, `SUM`, `GROUP BY` — single fast DB queries.

### 1A. `GET /submissions/summary`

**File:** `backend/app/api/routes/submissions.py`

**Query params:** `form_id`, `program_id`, `status`, `date_from`, `date_to`

**Returns:**
```json
{
  "total": 545,
  "approved": 312,
  "flagged": 48,
  "synced": 185,
  "violations": 23,
  "backcheck_required": 15,
  "duplicate_suspects": 9,
  "by_form": [
    { "form_id": "...", "form_title": "Household Survey", "count": 320 }
  ],
  "by_enumerator": [
    { "enumerator_id": "...", "name": "Ravi Kumar", "count": 67 }
  ],
  "by_date": [
    { "date": "2026-04-01", "count": 12 }
  ]
}
```

**Note:** `duplicate_suspects` counted from `data_json->>'_duplicate_suspect' = 'true'` using a JSONB index-friendly cast — not a full scan.

**Verification after implementation:**
```bash
curl -H "Authorization: Bearer <token>" \
  "https://app.fieldgovern.com/api/v1/submissions/summary"
# Expect: JSON with total=545 (or actual count), all fields present
# Timing should be <200ms
```

---

### 1B. `GET /fg/programs/{program_id}/summary`

**File:** `backend/app/api/routes/field_govern.py`

**Returns:**
```json
{
  "program_id": "...",
  "program_name": "UNICEF Girl Education M&E",
  "scheme": "Bihar",
  "total_submissions": 545,
  "approved": 312,
  "flagged": 48,
  "quality_score": 91.2,
  "violations": 23,
  "enumerators": [
    { "name": "Ravi Kumar", "count": 67 }
  ],
  "wave_counts": [
    { "name": "Baseline", "wave_number": 1, "count": 280 }
  ],
  "column_count": 38,
  "date_range": { "first": "2026-01-10", "last": "2026-04-25" }
}
```

**Verification:**
```bash
curl -H "Authorization: Bearer <token>" \
  "https://app.fieldgovern.com/api/v1/fg/programs/<id>/summary"
# Expect: accurate counts, quality_score, all enumerator names
# Timing should be <300ms
```

---

### 1C. `GET /map/summary`

**File:** `backend/app/api/routes/field_map.py` (or create new route)

**Query params:** `form_id`, `program_id`, `date_from`, `date_to`

**Returns:**
```json
{
  "total_with_gps": 389,
  "total_submissions": 545,
  "forms": [
    { "form_id": "...", "title": "Household Survey", "gps_count": 210 }
  ],
  "enumerators": [
    { "name": "Ravi Kumar", "gps_count": 45 }
  ],
  "date_range": { "first": "2026-01-10", "last": "2026-04-25" },
  "bounds": {
    "lat_min": 24.5, "lat_max": 27.8,
    "lng_min": 83.2, "lng_max": 88.1
  }
}
```

**Verification:**
```bash
curl -H "Authorization: Bearer <token>" \
  "https://app.fieldgovern.com/api/v1/map/summary"
# Expect: total_with_gps < total_submissions, bounds are valid coords
```

---

### 1D. Backend: Slim List + `include_data` param

**File:** `backend/app/api/routes/submissions.py`

Change existing `GET /submissions/` to:
- Exclude `data_json` from response by default
- Add `include_data: bool = False` query param — when `True`, include full `data_json`
- Add `duplicate_suspect: bool` as a top-level field (extracted from `data_json` once, returned as plain bool)
- Keep `page_size` cap at 5000 for backwards compat but default to 50

**Response shape (slim, default):**
```json
{
  "items": [
    {
      "id": "...",
      "serial_no": 42,
      "form_id": "...",
      "form_title": "Household Survey",
      "enumerator_id": "...",
      "enumerator_name": "Ravi Kumar",
      "status": "approved",
      "has_violations": false,
      "backcheck_required": false,
      "duplicate_suspect": false,
      "local_created_at": "2026-04-01T10:22:00",
      "server_received_at": "2026-04-01T10:25:00"
    }
  ],
  "total": 545,
  "page": 1,
  "page_size": 50
}
```

**Verification:**
```bash
# Slim (default) — should be fast, no data_json
curl ".../submissions/?page_size=50" | jq '.items[0] | has("data_json")'
# Expect: false

# Full detail for one record
curl ".../submissions/<id>" | jq 'has("data_json")'
# Expect: true

# Timing comparison
time curl ".../submissions/?page_size=50"        # should be <100ms
time curl ".../submissions/?page_size=50&include_data=true"  # will be slower
```

---

## Tier 2 — Frontend: Page-by-Page Changes

### 2A. Dashboard (`/`)

**File:** `frontend/src/dashboard/Dashboard.modern.tsx`

**Current behaviour:** Fetches `page_size=5000&slim=true` on mount → blocks render until all 545+ submissions arrive.

**New behaviour:**
1. On mount: call `GET /submissions/summary` → populate tiles immediately
2. Show "Load Submissions" button in the submissions list tab
3. On click: fetch paginated slim list (50/page, server-side)
4. Search: triggers new API call with `q=` param (not client-side filter)
5. Full detail: `GET /submissions/{id}` on row click (already works)

**UI change — overview tiles (always loaded from summary):**
```
[Total: 545]  [Approved: 312]  [Flagged: 48]  [Violations: 23]
```

**UI change — submissions tab:**
```
┌─────────────────────────────────────────────┐
│  📋 Submissions                    [Load →]  │
│  Stats loaded. Click Load to view list.      │
└─────────────────────────────────────────────┘
```
After load → paginated table with prev/next.

**Verification:**
1. Open dashboard → tiles show correct counts without list loading
2. Click Load → list appears, paginated
3. Check network tab: summary call < 200ms, list call < 500ms
4. Total count in tile matches total shown in list pagination

---

### 2B. Map (`/map`)

**File:** `frontend/src/map/FieldMapPage.tsx`

**Current behaviour:** Auto-loads all submissions with GPS on mount.

**New behaviour:**
1. On mount: call `GET /map/summary` → show header stats
2. Show filter controls (date range, form, enumerator) before loading
3. Show **"Load GPS Points"** button with count badge: `Load 389 GPS Points →`
4. On click: fetch GPS-only data (lat, lng, enumerator_name, status, serial_no — no data_json)
5. Clicking a map pin shows slim info; "View Full Record" opens detail modal

**UI change — before load:**
```
┌──────────────────────────────────────────────────────────┐
│  🗺 Field Map   389 GPS points available · 545 total      │
│                                                           │
│  Filter: [Form ▾] [Enumerator ▾] [Date range]            │
│                                                           │
│             [ Load 389 GPS Points → ]                    │
└──────────────────────────────────────────────────────────┘
```

**Verification:**
1. Open map → summary shows correct GPS count, no pins yet
2. Click Load → pins appear on map
3. Apply filter → pin count updates, re-fetch only filtered set
4. Click pin → shows name, status, serial_no (no data_json loaded)
5. Click "View Full Record" → detail modal fetches full submission

---

### 2C. Analyzer (`/fg/analyzer`)

**File:** `frontend/src/programs/FgAnalyzer.tsx`

**Current behaviour:** On program select → calls `GET /fg/programs/{id}/analyzer-data` which fetches all submissions to build column headers + sample rows.

**New behaviour:**
1. On program select: call `GET /fg/programs/{id}/summary` → show overview stats immediately
2. Overview tab: populated from summary (no row data)
3. Tabulator tab: show "Load Column Data" button — on click fetches `analyzer-data` (column_headers + sample_rows for AI, not full submissions)
4. CSV tab: unchanged (file upload)

**Verification:**
1. Select program → overview stats appear without delay
2. Click Tabulator tab → "Load Column Data" button shows
3. Click button → columns load, AI suggest works
4. Stats in overview match backend summary endpoint counts

---

### 2D. FieldGovern Program Page (`/programs/:id/govern`)

**File:** `frontend/src/programs/FieldGovern.tsx`

**Current behaviour:** Loads submissions list on tab open.

**New behaviour:**
1. Stats panel: calls summary endpoint → always accurate
2. Submissions tab: shows "Load Submissions" button
3. On click: paginates slim list

**Verification:**
1. Open program page → stats accurate without submissions loading
2. Click Load → list appears with correct data

---

### 2E. File Manager (`/fg/files`)

**Current behaviour:** Loads file counts on mount — already fast.

**Change needed:** None — counts come from lightweight API calls already.

---

## Tier 3 — Database: Ensure Indexes Are Applied

**Migration:** `0030_submission_indexes.py` (already written, may not have run on server)

**Indexes added:**
```sql
ix_sub_tenant_program       ON submissions (tenant_id, program_id) WHERE program_id IS NOT NULL
ix_sub_tenant_program_recv  ON submissions (tenant_id, program_id, server_received_at DESC)
ix_sub_questionnaire        ON submissions (questionnaire_id) WHERE questionnaire_id IS NOT NULL
ix_sub_enumerator           ON submissions (enumerator_id)
ix_sub_tenant_status        ON submissions (tenant_id, status)
ix_sub_tenant_recvd         ON submissions (tenant_id, server_received_at DESC)
ix_sub_form_recvd           ON submissions (form_id, server_received_at DESC)
```

**Verification (run on server after deploy):**
```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'submissions';
-- Should show all 7 ix_sub_* indexes
```

**Additional index for duplicate_suspect (add to migration 0032):**
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sub_dup_suspect
  ON submissions ((data_json->>'_duplicate_suspect'))
  WHERE data_json->>'_duplicate_suspect' = 'true';
```

---

## Implementation Order

| Step | What | Files touched | Verify |
|---|---|---|---|
| 1 | `GET /submissions/summary` endpoint | `submissions.py` | curl timing + count accuracy |
| 2 | `GET /fg/programs/{id}/summary` endpoint | `field_govern.py` | curl timing + count accuracy |
| 3 | `GET /map/summary` endpoint | `field_map.py` | curl + bounds check |
| 4 | Slim list: add `duplicate_suspect` bool, remove `data_json` default | `submissions.py` | curl no data_json |
| 5 | Dashboard: summary tiles + Load button | `Dashboard.modern.tsx` | tiles load fast, list on demand |
| 6 | Map: Load button + summary header | `FieldMapPage.tsx` | map doesn't load on open |
| 7 | Analyzer: Load Column Data button | `FgAnalyzer.tsx` | overview instant, tabulator on demand |
| 8 | FieldGovern program page: Load button | `FieldGovern.tsx` | stats instant, list on demand |
| 9 | Migration 0032: duplicate_suspect index | `alembic/versions/` | pg_indexes check |

Each step is independent — can be deployed and verified one at a time.

---

## What Stays Unchanged

- All export endpoints (CSV, XLSX, SPSS, Stata) — fetch full data, expected
- Submission detail modal — already fetches single record on demand
- Cleaner tool — file upload based, no backend query
- Writer tool — generates from saved tabulations, not raw submissions
- Enumerator collect screen — syncs own submissions only, small dataset

---

## Expected Performance After Implementation

| Action | Before | After |
|---|---|---|
| Dashboard open | 2–8s (fetches 545 full records) | <300ms (summary only) |
| Map open | 3–10s (all GPS auto-load) | <200ms (summary only) |
| Load Submissions (dashboard) | — | <500ms (50 slim rows) |
| Load GPS Points (map) | — | <800ms (389 lat/lng only) |
| Analyzer program select | 2–5s | <300ms (summary only) |
| At 10,000 submissions | Would time out | Same speeds (indexed queries) |
