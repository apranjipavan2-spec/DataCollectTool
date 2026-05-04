"""Bin Creator — CRUD + auto-detect for categorization/recoding columns."""

from fastapi import APIRouter, HTTPException
from typing import Optional
from pydantic import BaseModel
import pandas as pd

from ..shared import datasets, custom_bins, sanitize_for_json, apply_metrics_and_bins

router = APIRouter()


class BinDef(BaseModel):
    dataset_id: str
    name: str
    source_column: str
    bin_type: str
    ranges: list[dict] = []
    frequency: Optional[str] = None
    mapping: Optional[dict] = None
    lower_inclusive: bool = True
    upper_inclusive: bool = False
    remainder_label: Optional[str] = None
    case_normalize: Optional[str] = None
    quantile_type: Optional[str] = None
    num_bins: Optional[int] = None
    fiscal_start_month: Optional[int] = None
    regex_patterns: list[dict] = []
    group_map: Optional[dict] = None
    date_ranges: list[dict] = []


@router.post("/api/bins/create")
async def create_bin(bindef: BinDef):
    """Create a bin/recode definition."""
    if bindef.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    bdef = bindef.model_dump()
    bins_list = custom_bins.get(bindef.dataset_id, [])
    bins_list = [b for b in bins_list if b["name"] != bindef.name]
    bins_list.append(bdef)
    custom_bins[bindef.dataset_id] = bins_list

    df = datasets[bindef.dataset_id]["df"].copy()
    df = apply_metrics_and_bins(df, bindef.dataset_id)

    if bindef.name in df.columns:
        value_counts = df[bindef.name].value_counts().to_dict()
        preview = {str(k): int(v) for k, v in list(value_counts.items())[:10]}
    else:
        preview = {}

    return {"name": bindef.name, "preview": preview, "type": "text"}


@router.delete("/api/bins/{dataset_id}/{bin_name}")
async def delete_bin(dataset_id: str, bin_name: str):
    if dataset_id not in custom_bins:
        raise HTTPException(404, "Dataset not found")
    custom_bins[dataset_id] = [b for b in custom_bins[dataset_id] if b["name"] != bin_name]
    return {"message": f"Bin '{bin_name}' deleted"}


@router.get("/api/bins/{dataset_id}")
async def list_bins(dataset_id: str):
    return {"bins": custom_bins.get(dataset_id, [])}


@router.get("/api/bin/auto_detect")
async def auto_detect_codings(dataset_id: str, column: str):
    """Auto-detect common codings in a column (e.g., 1/2 -> Male/Female)."""
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[dataset_id]["df"]
    if column not in df.columns:
        raise HTTPException(400, f"Column '{column}' not found")

    COMMON_CODINGS = {
        "1": "Male", "2": "Female", "3": "Other",
        "m": "Male", "f": "Female", "male": "Male", "female": "Female",
        "M": "Male", "F": "Female",
        "0": "No", "y": "Yes", "n": "No", "yes": "Yes", "no": "No",
        "true": "True", "false": "False", "t": "True",
        "a": "Excellent", "b": "Good", "c": "Average", "d": "Below Average",
        "99": "Unknown", "999": "Unknown", "-1": "N/A", "-99": "N/A",
    }

    unique_vals = df[column].dropna().astype(str).unique()
    detected = {}
    for v in unique_vals:
        v_lower = str(v).strip().lower()
        if v_lower in COMMON_CODINGS:
            detected[v] = COMMON_CODINGS[v_lower]
        elif str(v).strip() in COMMON_CODINGS:
            detected[v] = COMMON_CODINGS[str(v).strip()]

    return {"column": column, "mapping": detected, "detected_count": len(detected)}
