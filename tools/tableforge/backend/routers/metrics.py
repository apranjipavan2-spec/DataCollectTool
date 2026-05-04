"""Metric Builder — CRUD + preview for custom computed columns."""

from fastapi import APIRouter, HTTPException
from typing import Optional
from pydantic import BaseModel

from ..shared import datasets, custom_metrics, sanitize_for_json, apply_metrics_and_bins

router = APIRouter()


class MetricDef(BaseModel):
    dataset_id: str
    name: str
    metric_type: str
    column_a: Optional[str] = None
    column_b: Optional[str] = None
    operator: Optional[str] = None
    numerator: Optional[str] = None
    denominator: Optional[str] = None
    part: Optional[str] = None
    whole: Optional[str] = None
    current: Optional[str] = None
    previous: Optional[str] = None
    growth_type: str = "percentage"
    value_column: Optional[str] = None
    weight_column: Optional[str] = None
    condition_column: Optional[str] = None
    condition_operator: Optional[str] = None
    condition_value: Optional[str] = None
    then_column: Optional[str] = None
    else_column: Optional[str] = None
    cond_column: Optional[str] = None
    cond_operator: Optional[str] = None
    cond_value: Optional[str] = None
    cond_then_type: Optional[str] = None
    cond_then_col: Optional[str] = None
    cond_then_val: Optional[str] = None
    cond_else_type: Optional[str] = None
    cond_else_col: Optional[str] = None
    cond_else_val: Optional[str] = None
    format_type: str = "number"
    decimal_places: int = 2
    # Index
    base_column: Optional[str] = None
    base_value: Optional[float] = None
    # Rank
    rank_column: Optional[str] = None
    rank_order: Optional[str] = None


@router.post("/api/metrics/create")
async def create_metric(metric: MetricDef):
    """Create a custom metric and return preview values."""
    if metric.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[metric.dataset_id]["df"].copy()
    mdef = metric.model_dump()

    try:
        df = apply_metrics_and_bins(df, metric.dataset_id)
        temp_metrics = custom_metrics.get(metric.dataset_id, []) + [mdef]
        custom_metrics[metric.dataset_id] = temp_metrics

        df = apply_metrics_and_bins(df, metric.dataset_id)

        preview = df[metric.name].dropna().head(5).tolist()
        preview = sanitize_for_json(preview)

        return {
            "name": metric.name,
            "preview": preview,
            "type": "numeric",
            "message": f"Metric '{metric.name}' created successfully",
        }
    except Exception as e:
        custom_metrics[metric.dataset_id] = [m for m in custom_metrics.get(metric.dataset_id, []) if m["name"] != metric.name]
        raise HTTPException(400, f"Metric error: {str(e)}")


@router.post("/api/metrics/preview")
async def preview_metric(metric: MetricDef):
    """Preview a metric without persisting it."""
    if metric.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[metric.dataset_id]["df"].copy()
    mdef = metric.model_dump()
    try:
        df = apply_metrics_and_bins(df, metric.dataset_id)
        saved = custom_metrics.get(metric.dataset_id, [])
        custom_metrics[metric.dataset_id] = saved + [mdef]
        df = apply_metrics_and_bins(df, metric.dataset_id)
        preview = df[metric.name].dropna().head(8).tolist()
        preview = sanitize_for_json(preview)
        custom_metrics[metric.dataset_id] = saved
        return {"name": metric.name, "preview": preview}
    except Exception as e:
        custom_metrics[metric.dataset_id] = [m for m in custom_metrics.get(metric.dataset_id, []) if m["name"] != metric.name]
        raise HTTPException(400, f"Preview error: {str(e)}")


@router.delete("/api/metrics/{dataset_id}/{metric_name}")
async def delete_metric(dataset_id: str, metric_name: str):
    if dataset_id not in custom_metrics:
        raise HTTPException(404, "Dataset not found")
    custom_metrics[dataset_id] = [m for m in custom_metrics[dataset_id] if m["name"] != metric_name]
    return {"message": f"Metric '{metric_name}' deleted"}


@router.get("/api/metrics/{dataset_id}")
async def list_metrics(dataset_id: str):
    return {"metrics": custom_metrics.get(dataset_id, [])}
