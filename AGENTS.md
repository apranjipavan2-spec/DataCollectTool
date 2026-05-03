

## Tools

<!-- sigmap-tools -->

```json
[
  {
    "name": "sigmap_ask",
    "description": "Rank source files by relevance to a natural-language query. Run before exploring the codebase.",
    "command": "sigmap ask \"$QUERY\""
  },
  {
    "name": "sigmap_validate",
    "description": "Validate SigMap config and measure context coverage. Run after changing config or source dirs.",
    "command": "sigmap validate"
  },
  {
    "name": "sigmap_judge",
    "description": "Score an LLM response for groundedness against source context. Use to verify answer quality.",
    "command": "sigmap judge --response \"$RESPONSE\" --context \"$CONTEXT\""
  },
  {
    "name": "sigmap_query",
    "description": "Rank all files by relevance using TF-IDF and write a focused mini-context.",
    "command": "sigmap --query \"$QUERY\" --context"
  },
  {
    "name": "sigmap_weights",
    "description": "Show learned file-ranking multipliers accumulated from past sessions.",
    "command": "sigmap weights"
  }
]
```

## Auto-generated signatures
<!-- Updated by gen-context.js -->
# Code signatures

## SigMap commands

| When | Command |
|------|---------|
| Before answering a question | `sigmap ask "<your question>"` |
| After code changes | `sigmap validate` |
| To query by topic | `sigmap --query "<topic>"` |

Always run `sigmap ask` or `sigmap --query` before searching for files relevant to a task.
## deps
```
backend\app\api\routes\shared_files.py ← fastapi, sqlalchemy, app
backend\app\models\shared_file.py ← sqlalchemy, app
```

## backend

### backend\app\api\routes\shared_files.py
```
POST /  →  upload_shared_file()
GET /  →  list_shared_files()
GET /{file_id}/download  →  download_shared_file()
PATCH /{file_id}/share  →  update_sharing()
DELETE /{file_id}  →  delete_shared_file()
```

### backend\app\models\shared_file.py
```
class SharedFile(Base)
```

## frontend

### frontend\src\admin\AdminPanel.modern.tsx
```
component StatusBadge
component RoleBadge
component AdminPanel
hook useState
hook useMemo
hook useEffect
handler onChange
handler onClick
```
