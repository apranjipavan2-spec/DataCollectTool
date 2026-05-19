# FieldGovern

## Workflow
- Plan mode for 3+ step tasks. Verify: `npx tsc --noEmit --skipLibCheck` (fe), routes in `router.py` (be)
- Bug → fix + update `tasks/lessons.md`. Track in `tasks/todo.md`.

## Stack
Frontend: React 18+TS+Vite+Tailwind 4 · PWA: vite-plugin-pwa, OPFS+wa-sqlite (Chrome), IndexedDB (Safari)
Backend: FastAPI 0.111+SQLAlchemy 2.0+Alembic · DB: PostgreSQL 16+Redis 7 · Auth: JWT HS256+bcrypt
Deploy: Node 20 build → Python 3.13. wait_and_stamp.py → alembic upgrade → seed_dev → uvicorn

## Key Rules
1. New migration → patch `seed_dev.py _PATCHES` + detect in `wait_and_stamp.py`
2. New route → import + `include_router` in `app/api/router.py`
3. New nav → `<Route>` in `App.tsx`
4. User dep is dict: `user["tenant_id"]` not `user.tenant_id`
5. TopNav breadcrumbs: `path` not `href`
6. localStorage: namespace `fg_tabs_{programId}`
7. No `CREATE INDEX CONCURRENTLY` in Alembic. Use `CREATE INDEX IF NOT EXISTS`
8. Idempotent migrations: `ADD COLUMN IF NOT EXISTS` via `op.get_bind().execute(sa.text(...))`
9. Vite manualChunks: vendor only. App code → TDZ crash. Use `React.lazy()`
10. Leaflet: npm only, no CDN. Tiles need `*.tile.openstreetmap.org` in CSP img-src
11. Marketing site: edit `website/` ONLY. CI (`.github/workflows/deploy-website.yml`) auto-syncs `website/ → docs/` on push. Never edit `docs/` directly — it gets overwritten. `website/status.html` is excluded from sync.

## Paths
`backend/app/api/routes/`, `frontend/src/programs/` (FgAnalyzer, FgCleaner, FieldGovern), `frontend/src/dashboard/`, `tasks/` (todo.md, lessons.md)
Current DB: 0035. Repo: https://github.com/apranjipavan2-spec/DataCollectTool


## Auto-generated signatures
<!-- Updated by gen-context.js -->
# Code signatures

## deps
```
backend\app\api\routes\field_govern.py ← fastapi, pydantic, sqlalchemy, app, pandas
frontend\src\programs\BatchRenameModal.tsx ← lib/api, lib/ToastContext
frontend\src\programs\FgAnalyzer.tsx ← BatchRenameModal
```

## backend

### backend\app\api\routes\field_govern.py
```
class WaveIn(BaseModel) {questionnaire_id*, wave_number*, wave_label*, panel_key?}
class TabulateRequest(BaseModel) {column_headers*, sample_rows?, user_prompt?, research_type?}
class TabulateExecuteRequest(BaseModel) {groupby_field*, value_field*, aggregation?, form_ids?, chart_type?, title?}
class TabulateCsvRequest(BaseModel) {rows*, groupby_field*, value_field?, aggregation?, chart_type?, title?}
class WriterRequest(BaseModel) {style?, date_range?, custom_context?, tabulation_data?}
class RestoreRequest(BaseModel) {analysis_id*}
class FeedbackRequest(BaseModel) {vote?}
class SmartBuildRequest(BaseModel) {column_ids?, column_headers?, query?}
class PolishRequest(BaseModel) {title*, groupby_field*, value_field?, aggregation?, rows?, is_cross_tab?}
class InterpretRequest(BaseModel) {title*, subtitle?, groupby_field*, value_field?, aggregation?, rows?}
class SaveTabulationRequest(BaseModel) {tabulation*}
class AutoGenerateRequest(BaseModel) {objectives?}
class BatchUpdateRequest(BaseModel) {tabulations?}
GET /programs/{program_id}/waves  →  get_waves()
PATCH /programs/{program_id}/panel-study  →  toggle_panel_study()
PUT /programs/{program_id}/waves  →  set_wave()
DELETE /programs/{program_id}/waves/{questionnaire_id}  →  clear_wave()
GET /programs/{program_id}/attrition  →  attrition_report()
GET /programs/{program_id}/analyzer-data  →  get_analyzer_data()
GET /programs/{program_id}/summary  →  get_program_summary()
POST /programs/{program_id}/tabulate/suggest  →  suggest_tabulation()
POST /programs/{program_id}/tabulate/smart-build  →  smart_build_tabulation()
POST /programs/{program_id}/tabulate/polish  →  polish_tabulation()
POST /programs/{program_id}/tabulate/interpret  →  interpret_tabulation()
POST /programs/{program_id}/tabulate/execute  →  execute_tabulation()
POST /tabulate-csv  →  tabulate_csv()
GET /programs/{program_id}/analysis  →  get_analysis()
GET /programs/{program_id}/writer-tables  →  get_writer_tables()
GET /programs/{program_id}/analysis/status  →  get_analysis_status()
GET /programs/{program_id}/analysis/history  →  get_analysis_history()
```

### backend\app\services\ai_service.py
```
async def generate_report(cfg: dict, form_title: str, field_labels: list, submissions: list) → str
async def suggest_skip_logic(cfg: dict, question_text: str, form_fields: list, user_description: str) → list  # Return 1-3 SkipLogic suggestions in frontend-compatible form
async def generate_styled_report(cfg: dict, style: str, form_title: str, date_range: str, sample_size: int, table_data: str, chart_descriptions: str, custom_context: str) → str
```

## frontend

### frontend\src\programs\BatchRenameModal.tsx
```
component BatchRenameModal
props Props
hook useToast
hook useState
hook useRef
export SavedTabulation
export BatchRenameModal
handler onClick
handler onChange
```

### frontend\src\programs\FgAnalyzer.tsx
```
component StatCard
component OverviewTab
component TabulationCard
component TabulatorTab
component PanelStudyTab
component CsvTab
component ProgramPicker
component FgAnalyzer
hook useToast
hook useState
hook useCallback
hook useEffect
hook useRef
handler onClick
handler onChange
handler onDelete
handler onUpdate
handler onComplete
```
