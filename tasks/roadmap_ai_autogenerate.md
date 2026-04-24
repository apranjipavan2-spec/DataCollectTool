# Roadmap — 1-Click AI Auto-Generate Insights
_Living document. Updated after every build session._
_Last updated: 2026-04-24 (Phase 6 complete — ALL PHASES DONE)_

---

## Confirmed Architecture Decisions

| Concern | Decision | Alternatives Rejected |
|---|---|---|
| Long AI wait (20-60s) | Background task → "check back later" | SSE (complex, keep-alive risk), WebSocket (overkill), Long-polling (ties up connections) |
| AI generation cost | FastAPI `BackgroundTasks` + `pending` record in DB | Celery+Redis (infrastructure overhead), Synchronous (timeouts) |
| AI rate limiting | DB count of runs per program per day | Redis counter (new dependency), In-memory (lost on restart) |
| Auto-refresh of charts | Frontend 30-min timer, unlimited | Backend cron (harder to per-user), WebSocket push (overkill for 30-min cadence) |
| Config storage | New `program_analysis` DB table, JSONB | localStorage (per-browser, no history, no sync), programs.JSONB column (not scalable) |
| Categorical values for AI | Form schema options first, then distinct values from submissions | Full distinct query only (slow on large datasets), Schema only (misses actual values) |
| Hallucination guard | Post-process: drop invalid columns, retry once | Pydantic strict validation (no retry), Ignore (bad UX) |
| History view | Simple list of past runs | Full diff/timeline (scope creep for now) |
| Data cleaning history | Summary JSONB stored at generation time | Separate log table (over-engineered), Computed on page load (slow) |
| Objectives verification | Included in same AI prompt (no extra API call) | Separate validation call (doubles cost) |

---

## Phases

---

### Phase 1 — DB Foundation _(Unblocks everything)_
**Status: ✅ Complete**

Everything after this depends on configs being in the DB, not localStorage.

#### 1a. Migration: `program_analysis` table
```sql
CREATE TABLE program_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID NOT NULL REFERENCES programs(id),
    tenant_id UUID NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    status TEXT DEFAULT 'pending',     -- pending | done | failed
    objectives TEXT,                   -- user-typed context
    table_configs JSONB DEFAULT '[]',  -- array of {title, groupby_field, ...}
    cleaning_summary JSONB DEFAULT '{}',
    ai_rationale TEXT,                 -- AI's explanation of its choices
    error_text TEXT,                   -- if status=failed
    run_count INT DEFAULT 0,           -- how many AI runs today (for rate limit)
    last_run_at TIMESTAMPTZ            -- for 5-min gap enforcement
);
```

#### 1b. Rate limit table (per program, per day)
Instead of a separate table, use `program_analysis` itself:
- Count rows WHERE `program_id = X AND created_at >= today AND status != 'failed'`
- Check `last_run_at` for 5-min gap
- Limit: 2 AI generations per program per day

#### 1c. Backend: migrate execute endpoint
- After `tabulate/execute` runs, save the result config to `program_analysis`
- `GET /fg/programs/{id}/analysis` → return saved configs (replaces localStorage)
- `GET /fg/programs/{id}/analysis/status` → return `{status, updated_at, table_count}`
- `GET /fg/programs/{id}/analysis/history` → list of past runs

#### 1d. Frontend: swap localStorage → API
- `loadTabulations(programId)` → `GET /fg/programs/{id}/analysis`
- `saveTabulation(...)` → handled server-side after execute
- Keep localStorage as a session-only cache (fallback if API call is slow)

**Verify:** Tabulations persist across browser sessions and are visible to all org members.

---

### Phase 2 — Background AI Generation + Rate Limiting
**Status: ✅ Complete**

#### 2a. Backend: background generation endpoint
```
POST /fg/programs/{id}/auto-generate
Body: { objectives: string }
Returns immediately: { analysis_id, status: "pending", message: "Check back in ~2 min" }
```
- Creates `program_analysis` row with `status='pending'`
- Fires `BackgroundTasks` → calls AI → validates → saves configs → updates status to `done`/`failed`

#### 2b. Rate limit enforcement (backend)
```python
# In auto-generate endpoint, before starting:
today_runs = db.query(ProgramAnalysis).filter(
    ProgramAnalysis.program_id == program_id,
    ProgramAnalysis.created_at >= today_start,
    ProgramAnalysis.status != 'failed',
).count()
if today_runs >= 2:
    raise HTTPException(429, "Daily AI generation limit reached (2/day)")
if last_run and (now - last_run) < timedelta(minutes=5):
    raise HTTPException(429, "Please wait 5 minutes between AI generations")
```

#### 2c. AI payload improvements (do here, not later)
Before calling AI:
1. Extract distinct values for `single_choice` / `multiple_choice` columns from form schema options
2. Also run `data_json` aggregation to get actual distinct values seen in submissions (top 20)
3. Include in prompt: `"district: single_choice, values seen: [North, South, East, West]"`

This dramatically improves AI suggestion quality — do it at the same time as the background job.

#### 2d. Hallucination guardrail (validate before saving)
```python
valid_col_ids = {c["id"] for c in column_headers}
def is_valid(config):
    return (config.get("groupby_field") in valid_col_ids and
            (config.get("value_field") in valid_col_ids or config.get("value_field") == "*") and
            (not config.get("secondary_groupby") or config.get("secondary_groupby") in valid_col_ids))

valid_configs = [c for c in ai_configs if is_valid(c)]
# If < 3 valid configs survived, retry AI once with stricter prompt
```

#### 2e. Frontend: polling for pending status
- After triggering, show banner: _"AI is analyzing your dataset — check back in ~2 minutes"_
- Poll `GET /fg/programs/{id}/analysis/status` every 30s
- When `status == 'done'`, auto-load configs and render tables
- When `status == 'failed'`, show error with retry button

**Verify:** Close the browser tab, come back 2 min later, tables are ready.

---

### Phase 3 — 1-Click UI Flow
**Status: ✅ Complete**

#### 3a. "Auto-Generate AI Insights" button
- Prominent button in FG Analyzer (Tabulator tab, or its own Overview section)
- State: `hasGeneratedBefore` = check DB for existing `done` run for this program

#### 3b. Guardrail modal (2nd click)
```
"You already have 6 generated tables from [date].
 [Use Existing]  /  [Regenerate with AI]"
```
- "Use Existing" → just loads and displays existing configs
- "Regenerate with AI" → shows objectives modal → triggers background job

#### 3c. Objectives modal
```
"Do you have specific objectives for this study?"
[textarea — optional]
[Skip]  /  [Generate Insights]
```
- If objectives provided, included in AI prompt for cross-verification
- AI instructed: "If a user objective cannot be answered with the available columns, say so in your rationale"

#### 3d. Multi-step loading messages (while pending)
Cycle through every 8s while polling:
```
"Analyzing dataset schema..."
"Mapping study objectives..."  
"Identifying key variables..."
"Generating cross-tabulations..."
"Validating outputs..."
"Almost ready..."
```
Shows the user AI is "thinking" even though it's a background job.

#### 3e. Rate limit UI feedback
- Show: _"AI generations today: 1 of 2 used"_
- When limit hit: _"Daily limit reached. Resets at midnight. Your existing tables auto-refresh with new data."_

**Verify:** Full flow — click → modal → objectives → pending state → tables appear.

---

### Phase 4 — Auto-Refresh (30-min timer)
**Status: ✅ Complete**

Auto-refresh re-runs `tabulate/execute` with saved configs against fresh submission data. **No AI call — pure Python aggregation.**

#### 4a. Frontend: 30-min refresh timer
```typescript
// In FgAnalyzer, after configs are loaded:
useEffect(() => {
  const interval = setInterval(() => refreshTableData(), 30 * 60 * 1000)
  return () => clearInterval(interval)
}, [programId])

const refreshTableData = async () => {
  // For each saved config, re-call tabulate/execute
  // Update rows in place — no AI call, no UI disruption
}
```

#### 4b. Backend: batch re-execute endpoint
```
POST /fg/programs/{id}/analysis/refresh
Body: { analysis_id: string }
Returns: updated table_configs with fresh rows
```
- Re-runs execute for all saved configs in one call
- Updates `updated_at` on the `program_analysis` row

#### 4c. UI: last refreshed timestamp
- Show: _"Data as of 14:32 — refreshes automatically every 30 min"_
- Manual refresh button for on-demand

**Verify:** Submit a new form response, wait 30 min (or click manual refresh), see count update.

---

### Phase 5 — History View
**Status: ✅ Complete**

Simple list — no diff view yet.

#### 5a. History panel in FG Analyzer
- Tab or collapsible sidebar: "Past AI Runs"
- Shows: run date, who triggered it, objectives, number of tables, status
- Click a past run → loads its configs (read-only view)
- "Restore this run" → replaces current active configs

#### 5b. Cleaning summary in history
- At generation time, compute:
  - Total submissions processed
  - Submissions skipped (no data_json)
  - Columns with >20% missing values (flagged)
- Save as `cleaning_summary JSONB` on the analysis record
- Show in history: _"6 tables · 847 submissions · 2 columns with >20% missing"_

**Verify:** Run AI twice, see both in history, restore an older run.

---

### Phase 6 — Polish & Guard Rails
**Status: ✅ Complete**

- Cap AI output at 10 tables (post-filter, even though AI thinks it's uncapped)
- Show `rationale` per table as a tooltip or expandable row ("Why did AI choose this?")
- "Feedback" button per table — thumbs up/down stored in DB for future fine-tuning
- Export entire analysis as PDF / Word (pipe into FG Writer)
- Objectives mismatch warning: if AI rationale says "column X not found", surface it to user

---

## Current State Summary

| Phase | Feature | Status |
|---|---|---|
| Pre-phase | AI suggests tables (manual prompt) | ✅ Done |
| Pre-phase | Cross-tabulation (secondary_groupby) | ✅ Done |
| Pre-phase | show_percent (count + %) | ✅ Done |
| Pre-phase | Sample rows sent to AI | ✅ Done |
| Pre-phase | AI decides table count from prompt | ✅ Done |
| 1 | program_analysis DB table | ✅ Done |
| 1 | Migrate configs from localStorage to DB | ✅ Done |
| 2 | Background generation endpoint | ✅ Done |
| 2 | Rate limiting (2/day, 5-min gap) | ✅ Done |
| 2 | Categorical values in AI prompt | ✅ Done |
| 2 | Hallucination guardrail | ✅ Done |
| 2 | Frontend polling for pending status | ✅ Done |
| 3 | Auto-Generate button + guardrail modal | ✅ Done |
| 3 | Objectives modal | ✅ Done |
| 3 | Multi-step loading messages | ✅ Done |
| 3 | Rate limit UI feedback | ✅ Done |
| 4 | 30-min auto-refresh timer | ✅ Done |
| 4 | Batch re-execute endpoint | ✅ Done |
| 4 | Last-refreshed timestamp UI | ✅ Done |
| 5 | History view | ✅ Done |
| 5 | Cleaning summary | ✅ Done |
| 6 | Rationale tooltips | ✅ Done |
| 6 | Feedback per table | ✅ Done |
| 6 | Export analysis to FG Writer | ✅ Done |

---

## Key Constraints
- AI generation: **2 per program per day**, **5-min gap** between runs
- Auto-refresh: **every 30 min**, unlimited, pure Python (no AI)
- AI payload: column schema + top-20 distinct values per categorical col + max 8 sample rows
- Max tables per AI run: **10** (post-filter)
- Background task: FastAPI `BackgroundTasks` (no Celery needed for now)
- DB: PostgreSQL JSONB for all config storage

## Next Action
**All phases complete.** The 1-Click AI Auto-Generate Insights feature is fully built.
