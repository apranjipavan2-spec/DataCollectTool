"""Period Comparisons, Annotations, and Cell Drill-Down."""

import traceback
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..shared import datasets, annotations, sanitize_for_json, add_audit_log, apply_metrics_and_bins

router = APIRouter()


# ── Period-over-Period Comparisons ──

class ComparisonConfig(BaseModel):
    dataset_id: str
    date_column: str
    value_column: str
    group_by: list[str] = []
    comparisons: list[str] = []
    moving_avg_n: int = 3


@router.post("/api/compare")
async def period_comparison(config: ComparisonConfig):
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[config.dataset_id]["df"].copy()
    df = apply_metrics_and_bins(df, config.dataset_id)

    date_col = config.date_column
    val_col = config.value_column

    if date_col not in df.columns or val_col not in df.columns:
        raise HTTPException(400, "Specified columns not found")

    try:
        if df[date_col].dtype == 'object':
            df[date_col] = pd.to_datetime(df[date_col], errors="coerce")

        group_cols = [date_col] + config.group_by
        agg_df = df.groupby(group_cols, dropna=False)[val_col].sum().reset_index()
        agg_df = agg_df.sort_values(date_col)

        if config.group_by:
            result_frames = []
            for name, group in agg_df.groupby(config.group_by):
                group = group.sort_values(date_col).reset_index(drop=True)
                group = _add_comparisons(group, date_col, val_col, config.comparisons, config.moving_avg_n)
                result_frames.append(group)
            result = pd.concat(result_frames, ignore_index=True)
        else:
            result = _add_comparisons(agg_df, date_col, val_col, config.comparisons, config.moving_avg_n)

        result[date_col] = result[date_col].astype(str)

        headers = list(result.columns)
        rows = sanitize_for_json(result.fillna("").values.tolist())
        add_audit_log(config.dataset_id, "comparison", f"Period comparison on {val_col} by {date_col}")
        return {"headers": headers, "rows": rows, "row_count": len(rows), "col_count": len(headers)}

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Comparison error: {str(e)}")


def _add_comparisons(df: pd.DataFrame, date_col: str, val_col: str, comparisons: list, moving_n: int) -> pd.DataFrame:
    for comp in comparisons:
        if comp == "prev_period":
            df["Previous Period"] = df[val_col].shift(1)
        elif comp == "abs_change":
            df["Absolute Change"] = df[val_col] - df[val_col].shift(1)
        elif comp == "pct_change":
            prev = df[val_col].shift(1).replace(0, np.nan)
            df["% Change"] = ((df[val_col] - prev) / prev * 100).round(2)
        elif comp == "yoy_value":
            df["Same Period Last Year"] = df[val_col].shift(12)
        elif comp == "yoy_abs":
            df["YoY Absolute Change"] = df[val_col] - df[val_col].shift(12)
        elif comp == "yoy_pct":
            prev = df[val_col].shift(12).replace(0, np.nan)
            df["YoY % Change"] = ((df[val_col] - prev) / prev * 100).round(2)
        elif comp == "period_avg":
            df["Period Average"] = df[val_col].expanding().mean().round(2)
        elif comp == "deviation":
            avg = df[val_col].expanding().mean()
            df["Deviation from Avg"] = (df[val_col] - avg).round(2)
        elif comp == "cum_ytd":
            if pd.api.types.is_datetime64_any_dtype(df[date_col]):
                df["Cumulative YTD"] = df.groupby(df[date_col].dt.year)[val_col].cumsum()
            else:
                df["Cumulative YTD"] = df[val_col].cumsum()
        elif comp == "moving_avg":
            df[f"Moving Avg ({moving_n})"] = df[val_col].rolling(window=moving_n, min_periods=1).mean().round(2)
    return df


# ── Annotations ──

class AnnotationData(BaseModel):
    dataset_id: str
    table_id: str
    row: int
    col: int
    text: str = ""
    color: str = ""


@router.post("/api/annotations/save")
async def save_annotation(data: AnnotationData):
    if data.dataset_id not in annotations:
        annotations[data.dataset_id] = {}
    table_annots = annotations[data.dataset_id].setdefault(data.table_id, [])
    table_annots = [a for a in table_annots if not (a["row"] == data.row and a["col"] == data.col)]
    if data.text or data.color:
        table_annots.append({"row": data.row, "col": data.col, "text": data.text, "color": data.color})
    annotations[data.dataset_id][data.table_id] = table_annots
    return {"message": "Annotation saved"}


@router.get("/api/annotations/{dataset_id}/{table_id}")
async def get_annotations(dataset_id: str, table_id: str):
    return {"annotations": annotations.get(dataset_id, {}).get(table_id, [])}


# ── Cell Drill-Down ──

class DrillDownConfig(BaseModel):
    dataset_id: str
    rows: list[str] = []
    columns: list[str] = []
    values: list[dict] = []
    filters: dict = {}
    cell_row_values: dict = {}
    cell_col_values: dict = {}


@router.post("/api/drilldown")
async def drill_down(config: DrillDownConfig):
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[config.dataset_id]["df"].copy()
    df = apply_metrics_and_bins(df, config.dataset_id)

    for col, vals in config.filters.items():
        if vals and col in df.columns:
            df = df[df[col].astype(str).isin([str(v) for v in vals])]

    for col, val in config.cell_row_values.items():
        if col in df.columns:
            df = df[df[col].astype(str) == str(val)]

    for col, val in config.cell_col_values.items():
        if col in df.columns:
            df = df[df[col].astype(str) == str(val)]

    preview = df.head(100)
    headers = list(preview.columns)
    rows = sanitize_for_json(preview.fillna("").values.tolist())
    return {"headers": headers, "rows": rows, "row_count": len(df), "showing": len(preview)}
