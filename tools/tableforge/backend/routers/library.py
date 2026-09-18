"""Global Metric Library — save, browse, import reusable metric definitions."""

import json
import uuid
from datetime import datetime
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..shared import custom_metrics, LIBRARY_DIR, add_audit_log

router = APIRouter()


class LibraryMetric(BaseModel):
    name: str
    metric_type: str
    definition: dict
    tags: list = []
    category: str = "General"
    description: str = ""


@router.get("/api/library/metrics")
async def list_library_metrics(search: str = "", tag: str = "", category: str = ""):
    all_metrics = []
    for f in LIBRARY_DIR.glob("*.json"):
        try:
            all_metrics.append(json.loads(f.read_text()))
        except Exception:
            pass
    all_categories = sorted(set(m.get("category", "General") for m in all_metrics))
    all_tags_list = sorted(set(t for m in all_metrics for t in m.get("tags", [])))
    filtered = []
    for data in all_metrics:
        name_match = not search or search.lower() in data.get("name", "").lower() or search.lower() in data.get("description", "").lower()
        tag_match = not tag or tag in data.get("tags", [])
        cat_match = not category or data.get("category", "General") == category
        if name_match and tag_match and cat_match:
            filtered.append(data)
    return {
        "metrics": sorted(filtered, key=lambda m: -m.get("usage_count", 0)),
        "categories": all_categories,
        "all_tags": all_tags_list,
    }


@router.post("/api/library/metrics")
async def save_library_metric(metric: LibraryMetric):
    metric_id = str(uuid.uuid4())
    filepath = LIBRARY_DIR / f"{metric_id}.json"
    data = {
        "id": metric_id,
        "name": metric.name,
        "metric_type": metric.metric_type,
        "definition": metric.definition,
        "tags": metric.tags,
        "category": metric.category,
        "description": metric.description,
        "usage_count": 0,
        "created_at": datetime.now().isoformat(),
    }
    filepath.write_text(json.dumps(data, indent=2))
    return data


@router.delete("/api/library/metrics/{metric_id}")
async def delete_library_metric(metric_id: str):
    filepath = LIBRARY_DIR / f"{metric_id}.json"
    if not filepath.exists():
        raise HTTPException(404, "Metric not found in library")
    filepath.unlink()
    return {"message": "Deleted from library"}


@router.post("/api/library/metrics/{metric_id}/import")
async def import_library_metric(metric_id: str, dataset_id: str = Query(...)):
    filepath = LIBRARY_DIR / f"{metric_id}.json"
    if not filepath.exists():
        raise HTTPException(404, "Metric not found in library")
    data = json.loads(filepath.read_text())
    data["usage_count"] = data.get("usage_count", 0) + 1
    filepath.write_text(json.dumps(data, indent=2))
    if dataset_id not in custom_metrics:
        custom_metrics[dataset_id] = []
    mdef = {**data["definition"], "name": data["name"]}
    custom_metrics[dataset_id] = [m for m in custom_metrics[dataset_id] if m.get("name") != data["name"]]
    custom_metrics[dataset_id].append(mdef)
    add_audit_log(dataset_id, "library_import", f"Imported metric '{data['name']}' from library")
    return {"message": f"Imported '{data['name']}' into project", "metric": mdef}


@router.get("/api/library/metrics/{metric_id}/usage")
async def get_metric_usage(metric_id: str):
    filepath = LIBRARY_DIR / f"{metric_id}.json"
    if not filepath.exists():
        raise HTTPException(404, "Metric not found in library")
    data = json.loads(filepath.read_text())
    return {"id": metric_id, "name": data.get("name"), "usage_count": data.get("usage_count", 0)}
