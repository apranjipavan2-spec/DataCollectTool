"""Dataset operations: column values, data quality, column type, annotations, drilldown."""

import pandas as pd
import numpy as np
from typing import Optional, List, Dict

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..state import (
    datasets, custom_metrics, custom_bins, audit_logs,
    annotations, column_type_overrides,
    add_audit_log, _is_multi_choice, sanitize_for_json,
)

router = APIRouter()

# ─── Pydantic Models ─────────────────────────────────────

class ColumnValuesRequest(BaseModel):
    dataset_id: str


class CleanColumnRequest(BaseModel):
    dataset_id: str
    column: str
    operation: str  # "trim", "upper", "lower", "replace"


class CleanBulkRequest(BaseModel):
    dataset_id: str
    columns: List[str]


class AnnotationData(BaseModel):
    dataset_id: str
    table_id: str
    row: int
    column: str
    text: str
    color: str = "#FFFFFF"


# ─── Column Values Endpoint ─────────────────────────────────────

@router.get("/dataset/{dataset_id}/column/{column_name}/values")
async def get_column_values(dataset_id: str, column_name: str):
    """Get unique values for a column (for filters)."""
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[dataset_id]["df"]

    if column_name not in df.columns:
        raise HTTPException(404, f"Column '{column_name}' not found")

    # Apply metrics/bins
    from ..utils import apply_metrics_and_bins
    apply_metrics_and_bins(df, dataset_id)

    col_type = column_type_overrides.get(dataset_id, {}).get(column_name, "text")

    # Return values
    if col_type in ["numeric", "date"]:
        series = df[column_name].dropna()
    else:
        series = df[column_name].astype(str).replace("", np.nan).dropna()

    values = series.unique().tolist()
    null_count = int(series.isna().sum())

    add_audit_log(dataset_id, "column_values", f"Retrieved {len(values)} unique values, {null_count} nulls")

    return {
        "values": values,
        "null_count": null_count,
        "column_type": col_type,
    }


# ─── Data Quality Endpoint ─────────────────────────────────────

@router.get("/dataset/{dataset_id}/quality")
async def data_quality(dataset_id: str):
    """Calculate comprehensive data quality metrics."""
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[dataset_id]["df"]

    results = []
    for col in df.columns:
        col_type = column_type_overrides.get(dataset_id, {}).get(col, "text")
        total_rows = len(df)
        null_count = df[col].isna().sum()
        unique_count = df[col].nunique()

        if col_type == "text":
            # Check for multi-choice (comma-separated values)
            is_mc = _is_multi_choice(df[col])
            sample = df[col].dropna().head(50).astype(str)

            # Potential quality issues
            blank_pct = (df[col] == "").astype(int) / total_rows if col_type == "text" else 0
            duplicate_vals = []
            for val in df[col].dropna().astype(str):
                if sample.str.count(',') >= 2:
                    vals = [v.strip() for v in val.split(',') if v.strip()]
                    for v in vals:
                        if sample[col].astype(str).str.count(v) >= 2:
                            duplicate_vals.append(v)
            duplicate_count = len(set([str(v) for vals in duplicate_vals]))

            issues = []
            if blank_pct > 10:
                issues.append(f"{blank_pct:.1f}% blank values")
            if duplicate_count > 0:
                issues.append(f"{duplicate_count} possible duplicates")

            results.append({
                "column": col,
                "type": col_type,
                "is_multi_choice": is_mc,
                "total_rows": total_rows,
                "null_count": null_count,
                "unique_count": unique_count,
                "blank_pct": blank_pct,
                "duplicate_count": duplicate_count,
                "sample_values": [str(v) for v in sample[:10]],
                "issues": issues,
            })

    return {
        "metrics": results,
        "overall_quality": "Good" if len([r["issues"] for r in results]) == 0 else "Needs Review",
    }


# ─── Column Type Override Endpoint ─────────────────────────────

@router.post("/dataset/column_type")
async def set_column_type(req):
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    column_type_overrides[req.dataset_id] = {}
    column_type_overrides[req.dataset_id][req.column] = req.new_type

    col_type = column_type_overrides.get(req.dataset_id, {}).get(req.column, "text")

    df = datasets[req.dataset_id]["df"]

    if req.new_type == "numeric":
        df[req.column] = pd.to_numeric(df[req.column], errors="coerce")
    elif req.new_type in ("text", "multi_choice"):
        # If converting from numeric to text, keep original values
        df[req.column] = df[req.column].astype(str)
    elif req.new_type == "date":
        try:
            df[req.column] = pd.to_datetime(df[req.column], errors="coerce")
        except Exception:
            pass

    add_audit_log(req.dataset_id, "column_type_change", f"Changed '{req.column}' to {req.new_type}")

    return {"status": "ok", "column": req.column, "new_type": req.new_type}


# ─── Clean Column Endpoint ─────────────────────────────────────

@router.post("/dataset/clean_column")
async def clean_column(req: CleanColumnRequest):
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[req.dataset_id]["df"]
    original_dtype = str(df[req.column].dtype)

    if req.operation == "trim":
        df[req.column] = df[req.column].str.strip()
    elif req.operation == "upper":
        df[req.column] = df[req.column].str.upper()
    elif req.operation == "lower":
        df[req.column] = df[req.column].str.lower()
    elif req.operation == "replace":
        search = req.column
        replacement = df[req.column].astype(str)
        # Count matches before replacement
        matched = df[req.column].astype(str).str.lower().str.contains(replacement.str.lower(), na=False, regex=False).sum()
        df[req.column] = df[req.column].replace(search, replacement, regex=False)

    # Track what actually changed
    actual_dtype = str(df[req.column].dtype)
    changed_count = matched

    # If originally numeric and now text, update type override
    if actual_dtype in ("int", "float") and req.operation in ("trim", "upper", "lower", "replace"):
        column_type_overrides[req.dataset_id][req.column] = req.operation
        changed_count = 0  # Strings don't need override tracking

    add_audit_log(req.dataset_id, f"clean_{req.operation}", f"Modified {req.column}: {changed_count} rows. New dtype: {actual_dtype}")

    datasets[req.dataset_id]["df"] = df

    return {"status": "ok", "changed_count": changed_count}


# ─── Clean Bulk Endpoint ─────────────────────────────────────

@router.post("/dataset/clean_bulk")
async def clean_bulk(req: CleanBulkRequest):
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[req.dataset_id]["df"]
    cleaned_cols = []
    for col in req.columns:
        if col in df.columns:
            col_type = column_type_overrides.get(req.dataset_id, {}).get(col, "text")

            if req.operation == "trim":
                df[col] = df[col].str.strip()
            elif req.operation == "upper":
                df[col] = df[col].str.upper()
            elif req.operation == "lower":
                df[col] = df[col].str.lower()
            elif req.operation == "replace":
                df[col] = df[col].astype(str).replace("", np.nan)

            cleaned_cols.append(col)

    add_audit_log(req.dataset_id, "clean_bulk", f"Cleaned {len(cleaned_cols)} columns")

    return {"status": "ok", "cleaned_columns": cleaned_cols}


# ─── Annotation Endpoints ─────────────────────────────────────

@router.get("/annotations/{dataset_id}/{table_id}")
async def get_annotations(dataset_id: str, table_id: str):
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    annos = annotations.get(dataset_id, {}).get(table_id, [])
    annos = [a for a in annos if a["table_id"] == table_id]

    add_audit_log(dataset_id, "annotations_view", f"Retrieved {len(annos)} annotations for table {table_id}")

    return {"annotations": annos}


@router.post("/annotations/save")
async def save_annotation(req: AnnotationData):
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    if req.dataset_id not in annotations:
        annotations[req.dataset_id] = []

    if req.table_id not in annotations:
        annotations[req.dataset_id] = []

    annotations[req.dataset_id].append({
        "dataset_id": req.dataset_id,
        "table_id": req.table_id,
        "row": req.row,
        "column": req.column,
        "text": req.text,
        "color": req.color,
    })

    add_audit_log(req.dataset_id, "annotation_add", f"Saved annotation at row {req.row}, col {req.column}")

    return {"status": "ok"}


# ─── Cell Drill-Down Endpoints ─────────────────────────────

@router.post("/drilldown")
async def drill_down(req):
    from ..utils import apply_metrics_and_bins, add_audit_log
    from ..state import datasets

    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[req.dataset_id]["df"]

    # Apply metrics/bins
    apply_metrics_and_bins(df, req.dataset_id)

    # Create drill-down result
    results = []
    for val in df[req.values].unique():
        subset = df[df[req.values] == val]
        agg_data = []
        for col in df.columns:
            if col not in [req.values]:
                if col_type := column_type_overrides.get(req.dataset_id, {}).get(col, "text"):
                    agg_type = "sum"
                else:
                    agg_type = "mean"
                count = int(len(subset))
                if count > 0:
                    mean_val = float(subset[req.values].mean())
                    agg_data.append({
                        "value": val,
                        "column": col,
                        "agg_type": agg_type,
                        "count": count,
                        "mean": mean_val,
                    })

        if agg_data:
            results.append({
                "value": val,
                "drill_down": agg_data,
            })

    add_audit_log(req.dataset_id, "drill_down", f"Generated drill-down for {len(req.values)} value(s)")

    return {"results": results}
