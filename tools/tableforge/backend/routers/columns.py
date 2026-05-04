"""Column values endpoints — used for filter dropdowns and column queries."""

from fastapi import APIRouter, HTTPException, Query
import pandas as pd

from ..shared import datasets, apply_metrics_and_bins, _is_multi_choice

router = APIRouter()


@router.get("/api/dataset/{dataset_id}/column/{column_name}/values")
async def get_column_values(dataset_id: str, column_name: str):
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[dataset_id]["df"].copy()
    df = apply_metrics_and_bins(df, dataset_id)
    if column_name not in df.columns:
        raise HTTPException(404, f"Column '{column_name}' not found")

    is_mc = _is_multi_choice(df[column_name])
    _nan_strings = {'nan', 'NaN', 'None', '', '<NA>'}
    if is_mc:
        all_vals = set()
        for val in df[column_name].dropna().astype(str):
            for part in val.split(','):
                part = part.strip()
                if part and part not in _nan_strings:
                    all_vals.add(part)
        values = sorted(all_vals)
    else:
        values = df[column_name].dropna().unique().tolist()
        values = sorted([str(v) for v in values])
    return {"column": column_name, "values": values[:500], "is_multi_choice": is_mc}


@router.get("/api/dataset/{dataset_id}/column-values")
async def get_column_values_by_query(dataset_id: str, column: str = Query(...)):
    """Same as get_column_values but accepts column name as query param."""
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[dataset_id]["df"].copy()
    df = apply_metrics_and_bins(df, dataset_id)
    if column not in df.columns:
        raise HTTPException(404, f"Column '{column}' not found")

    is_mc = _is_multi_choice(df[column])
    _nan_strings = {'nan', 'NaN', 'None', '', '<NA>'}
    if is_mc:
        all_vals: set = set()
        for val in df[column].dropna().astype(str):
            for part in val.split(','):
                part = part.strip()
                if part and part not in _nan_strings:
                    all_vals.add(part)
        values = sorted(all_vals)
    else:
        values = df[column].dropna().unique().tolist()
        values = sorted([str(v) for v in values])
    return {"column": column, "values": values[:500], "is_multi_choice": is_mc}
