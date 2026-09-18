# 1-Click AI Auto-Generate Insights — Shipped

All 6 phases complete (Phase 6 finished 2026-04-24). Code is the source of truth; this file remains only to document key constraints and architectural decisions for future maintenance.

## What shipped

- DB table `program_analysis` (configs in JSONB, replaces localStorage)
- Background generation via FastAPI `BackgroundTasks` (no Celery)
- Rate limit: **2 AI runs per program per day**, **5-min gap** between runs
- AI payload: schema + top-20 distinct values per categorical col + max 8 sample rows
- Hallucination guardrail: validate AI column refs against form schema, retry once if <3 valid
- Frontend polls `GET /fg/programs/{id}/analysis/status` every 30s while pending
- Auto-refresh: pure-Python re-execute of saved configs every 30 min (no AI call)
- History view + cleaning summary (submissions processed, columns with >20% missing)
- Cap at 10 tables per AI run (post-filter)
- Rationale tooltips, per-table feedback (thumbs up/down), export to FG Writer

## Constraints to preserve

- Never call AI on the auto-refresh path — it must stay free + unlimited
- Categorical values come from form schema first, then top-20 distinct from submissions
- Rate-limit check uses `program_analysis` row count (no separate counter table)
- All configs stored as JSONB on `program_analysis.table_configs`
