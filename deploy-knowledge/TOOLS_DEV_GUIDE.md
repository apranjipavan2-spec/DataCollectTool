# Tools Development Guide — TableForge & DataCleaner

> Reference this when editing the Analyzer (TableForge) or Cleaner (DataCleaner) tools.

---

## Where Everything Lives

```
DataCollectTool/
├── tools/
│   ├── tableforge/               ← Analyzer tool (served at /analyzer/)
│   │   ├── backend/
│   │   │   └── main.py           ← ALL backend logic (FastAPI, ~3900 lines)
│   │   ├── frontend/
│   │   │   └── src/
│   │   │       ├── App.tsx       ← Main app state, URL param reading, FG context
│   │   │       ├── api.ts        ← All fetch calls to backend + FG proxy helpers
│   │   │       ├── types.ts      ← TypeScript types (DatasetMeta, TableConfig, etc.)
│   │   │       └── components/
│   │   │           ├── WelcomeScreen.tsx   ← FG program/questionnaire picker + file upload
│   │   │           ├── ProjectManager.tsx  ← Save/load projects + FG DB sync
│   │   │           ├── TopBar.tsx          ← Menu bar with File/Insert/Data/Statistics
│   │   │           ├── SourcePanel.tsx     ← Left column list sidebar
│   │   │           ├── DropZones.tsx       ← Row/column/value drop areas
│   │   │           ├── LivePreview.tsx     ← Table result rendering
│   │   │           └── [20+ other components]
│   │   └── Dockerfile            ← Multi-stage: node build → python serve
│   │
│   └── datacleaner/              ← Cleaner tool (served at /cleaner/)
│       ├── data_cleaner.py       ← ALL logic: Flask backend + template rendering
│       ├── templates/
│       │   └── data_cleaner.html ← Single-file HTML+CSS+JS frontend (~1800 lines)
│       └── Dockerfile            ← python:3.11-slim, runs data_cleaner.py
```

---

## How to Edit & Deploy

### Step-by-step workflow

1. **Edit files locally** in `tools/tableforge/` or `tools/datacleaner/`
2. **Push to git**: `git add -A && git commit -m "..." && git push origin main`
3. **GitHub Actions auto-deploys** — takes ~5–8 minutes:
   - Builds Docker images for both tools **on the VPS** (not GitHub runner)
   - Restarts containers on the same Docker network as nginx

**You do NOT need to:**
- Run `npm run build` locally for TableForge — the Docker build does it
- SSH into the VPS manually
- Restart anything manually

### What triggers a rebuild

Pushing any file under `tools/**` triggers the deploy workflow.  
Workflow file: `.github/workflows/deploy-app.yml`

---

## TableForge — Key Patterns

### Adding a new backend endpoint

All endpoints are in `tools/tableforge/backend/main.py`. Pattern:

```python
class MyRequestBody(BaseModel):
    dataset_id: str
    some_param: str
    optional_param: Optional[str] = None

@app.post("/api/my-endpoint")
async def my_endpoint(body: MyRequestBody):
    if body.dataset_id not in datasets:
        raise HTTPException(400, "Dataset not found")
    df = datasets[body.dataset_id]["df"]
    # ... do work ...
    return {"result": "..."}
```

### Adding a new frontend API call

Add to `tools/tableforge/frontend/src/api.ts`:

```typescript
export async function myNewCall(datasetId: string, param: string) {
  const res = await fetch(`${API_BASE}/my-endpoint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, some_param: param }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
```

Then import and call it from `App.tsx` or any component.

### FieldGovern proxy endpoints (in main.py)

TableForge has 6 proxy endpoints that call the FieldGovern API on behalf of the user:

| Endpoint | What it does |
|----------|-------------|
| `POST /api/fg/programs` | Lists user's programs |
| `POST /api/fg/questionnaires` | Lists questionnaires for a program |
| `POST /api/fg/user-projects/save` | Saves project to FG DB |
| `POST /api/fg/user-projects/list` | Lists user's saved projects from FG DB |
| `POST /api/import-from-fg` | Imports program data as a dataset (supports `questionnaire_id`) |

All proxies take `{ fg_base_url, token }` in the body. The token comes from `?token=...` URL param set by FieldGovern when launching the wizard.

### FG context in the frontend

`App.tsx` reads URL params on mount and stores:
```typescript
const [fgContext, setFgContext] = useState<{ fgUrl: string; token: string; programId?: string } | null>(null);
```

Passed to `WelcomeScreen` (for program picker) and `ProjectManager` (for DB sync).

---

## DataCleaner — Key Patterns

### Adding a new backend endpoint

All endpoints are in `tools/datacleaner/data_cleaner.py`. Pattern:

```python
@app.route("/api/my-endpoint", methods=["POST"])
def my_endpoint():
    if DATA.get("df") is None:
        return jsonify(error="No data loaded"), 400
    body = request.json or {}
    # ... do work on DATA["df"] ...
    _save_state()
    mark_state_dirty()
    return jsonify(ok=True, result="...")
```

### Key global state

All state lives in the `DATA` dict (in-memory + persisted to `working_copies/app_state.pkl`):

| Key | What it holds |
|-----|--------------|
| `DATA["df"]` | Current pandas DataFrame |
| `DATA["original_df"]` | Unmodified copy (for reset) |
| `DATA["filename"]` | Source filename |
| `DATA["column_types"]` | Manual type overrides |
| `DATA["history"]` | Undo stack |
| `DATA["active_filters"]` | Current filter state |

Always call `_save_state()` and `mark_state_dirty()` after modifying `DATA`.

### Adding UI to the frontend

All UI is in `tools/datacleaner/templates/data_cleaner.html`. It's a single file with HTML, CSS (`<style>` block), and JavaScript (`<script>` block). Pattern for a new section:

```html
<!-- HTML: add a new card in the appropriate tab -->
<div class="card">
  <div class="card-header" onclick="toggleSection('mySection')">
    <span>My New Feature</span>
  </div>
  <div id="mySection">
    <!-- content -->
    <button onclick="myAction()">Do Thing</button>
  </div>
</div>

<script>
async function myAction() {
  const res = await fetch(BASE_URL + '/api/my-endpoint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ param: 'value' }),
  });
  const data = await res.json();
  if (data.error) { toast(data.error, 'error'); return; }
  toast('Done!');
  await loadInfo();  // refresh column stats
}
</script>
```

### FieldGovern proxy endpoints (in data_cleaner.py)

| Endpoint | What it does |
|----------|-------------|
| `POST /api/fg/programs` | Lists user's programs |
| `POST /api/fg/questionnaires` | Lists questionnaires for a program |
| `POST /api/fg/user-projects/save` | Saves cleaning state to FG DB |
| `POST /api/load-from-fg` | Loads program data (supports `questionnaire_id`) |

---

## FieldGovern Backend — Tool-Related APIs

These live in the **main FieldGovern backend** (`backend/app/api/routes/`), not in the tools:

| File | Endpoint | Description |
|------|----------|-------------|
| `field_govern.py` | `GET /fg/programs/{id}/export.xlsx?questionnaire_id=` | Exports submissions as Excel |
| `programs.py` | `GET /programs/{id}/questionnaires` | Lists questionnaires for a program |
| `user_tool_projects.py` | `GET/POST/DELETE /tool-projects/` | Per-user project CRUD |

**Adding a new tool-level feature that needs FieldGovern data:**
1. Add endpoint in `backend/app/api/routes/field_govern.py` or `programs.py`
2. Register in `backend/app/api/router.py` if it's a new file
3. Add proxy in the tool's backend (`main.py` or `data_cleaner.py`)
4. Call the proxy from the tool's frontend

---

## Per-User Project Saving

Projects are saved in two places:

1. **Docker volume** (local to tool container) — `fg_tableforge_data:/app/projects` and `fg_cleaner_data:/app/working_copies`
2. **FieldGovern DB** — `user_tool_projects` table, scoped to `user_id + tenant_id`

The DB save happens in `ProjectManager.tsx` (TableForge) via `fgSaveProject()` whenever the user manually saves a project. It's non-blocking — if FG is unreachable, the local save still completes.

Model location: `backend/app/models/user_tool_project.py`  
Migration: `backend/alembic/versions/0029_user_tool_projects.py`

---

## Docker & Networking

Both tools run as standalone containers on the same Docker network as nginx:

| Container | Image | Port | Volume |
|-----------|-------|------|--------|
| `analyzer` | `fieldgovern-analyzer:latest` | 8001 (internal) | `fg_tableforge_data`, `fg_tableforge_exports` |
| `cleaner` | `fieldgovern-cleaner:latest` | 8002 (internal) | `fg_cleaner_data` |

Nginx proxies `/analyzer/` → `http://analyzer:8001/` and `/cleaner/` → `http://cleaner:8002/`.  
The `/` prefix is stripped by the proxy_pass trailing slash.

**If a tool is broken in production:**
```bash
# Rebuild and restart just the analyzer
docker build -t fieldgovern-analyzer:latest /opt/fieldgovern/tools/tableforge
docker rm -f analyzer
docker run -d --name analyzer --network fieldgovern_default --restart unless-stopped \
  -v fg_tableforge_data:/app/projects \
  -v fg_tableforge_exports:/app/exports \
  fieldgovern-analyzer:latest

# Same for cleaner
docker build -t fieldgovern-cleaner:latest /opt/fieldgovern/tools/datacleaner
docker rm -f cleaner
docker run -d --name cleaner --network fieldgovern_default --restart unless-stopped \
  -v fg_cleaner_data:/app/working_copies \
  fieldgovern-cleaner:latest
```

---

## Common Gotchas

| Gotcha | Fix |
|--------|-----|
| TableForge frontend changes not showing | Dockerfile builds the frontend — just push, don't run npm manually |
| New endpoint not found (404) | Check you added the route decorator and function is not duplicated |
| Proxy call returns 405 | The FG backend endpoint may only have POST, not GET — add the missing method |
| Projects panel empty in wizard | Check `fgContext` is non-null (requires `?token=` in URL) |
| DataCleaner state lost on restart | State persists via pickle — but volumes must be mounted |
| Nginx not serving new config | `docker restart fieldgovern-nginx-1` (never just nginx -s reload — see DEPLOYMENT_KNOWLEDGE.md) |
