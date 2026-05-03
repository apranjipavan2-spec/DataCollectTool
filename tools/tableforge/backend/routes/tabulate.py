"""Tabulation engine with aggregation, binning, and display formatting."""

import re
import numpy as np
import pandas as pd
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..state import (
    datasets, custom_metrics, custom_bins,
    add_audit_log, _col_is_text, sanitize_for_json,
)
from ..utils import _is_multi_choice

router = APIRouter()

# ─── Pydantic Models ─────────────────────────────────────────────

class TableConfig(BaseModel):
    dataset_id: str
    rows: list[str] = []
    columns: list[str] = []
    values: list[dict] = []
    filters: dict = {}
    subtotals: bool = False
    subtotals_position: str = "bottom"
    grand_total: bool = True
    grand_total_rows: Optional[bool] = None  # None = follow grand_total
    grand_total_columns: Optional[bool] = None  # None = follow grand_total
    sort_by: Optional[str] = None
    sort_order: str = "asc"
    multi_sort: list[dict] = []
    custom_sort_orders: dict = {}   # {field: [cat1, cat2, ...]} for manual category ordering
    missing_data: str = ""
    date_groupings: dict = {}  # {col_name: "year"|"quarter"|"month"|"week"|"day"}
    blank_suppress: bool = False  # hide rows where all value cols are 0/blank

# ─── Constants ─────────────────────────────────────────────────────

AGG_MAP = {
    "sum": "sum", "count": "count", "average": "mean", "mean": "mean",
    "min": "min", "max": "max", "median": "median",
    "std": "std", "var": "var",
}
PERCENT_AGGS = {"pct_grand", "pct_row", "pct_col", "pct_parent_row", "pct_parent_col"}
SPECIAL_AGGS = {"running_total", "cumulative_sum", "rank_asc", "rank_desc", "index"}
NUMERIC_ONLY_AGGS = {"sum", "average", "mean", "min", "max", "median", "std", "var"}


# ─── Helper Functions ─────────────────────────────────────────────

def _col_is_text(df: pd.DataFrame, col_name: str) -> bool:
    """Return True if column is textual/categorical (not truly numeric)."""
    if col_name not in df.columns:
        return False
    dtype = str(df[col_name].dtype)
    if dtype != 'object':
        return False  # Already numeric/date/bool
    sample = df[col_name].dropna().head(50)
    if len(sample) == 0:
        return False
    try:
        pd.to_numeric(sample, errors='raise')
        return False  # Values look numeric
    except (ValueError, TypeError):
        pass
    return True  # Text type


def apply_metrics_and_bins(df: pd.DataFrame, dataset_id: str) -> pd.DataFrame:
    """Apply custom metrics and bins to all value columns."""
    from ..state import custom_metrics, custom_bins

    for col in df.columns:
        col_type = "text"
        dtype = str(df[col].dtype)
        if "int" in dtype or "float" in dtype:
            col_type = "numeric"
        elif "datetime" in dtype:
            col_type = "date"
        elif "bool" in dtype:
            col_type = "boolean"
        else:
            if _is_multi_choice(df[col]):
                col_type = "multi_choice"

        if col_type in ["numeric", "date", "boolean", "multi_choice"]:
            if dataset_id in custom_bins and col in custom_bins[dataset_id]:
                bin_def = next((b for b in custom_bins[dataset_id] if b["column_name"] == col), None)
            else:
                if col_type == "numeric":
                    bin_def = {"column_name": col, "bins": [0, 25, 50, 100, 500, 1000], "labels": ["0-25", "25-50", "50-100", "100-500", "500-1k", "1k+"]}

            if dataset_id in custom_metrics:
                metric_def = next((m for m in custom_metrics[dataset_id] if m["column_name"] == col), None)

    return col_type, bin_def if 'bin_def' in locals() else None, metric_def if 'metric_def' in locals() else None


# ─── Aggregation Helper Functions ────────────────────────────────────

def _agg_value(col: pd.Series, agg: str, decimals: int = 2) -> pd.Series:
    """Apply aggregation and format with decimal places."""
    if agg == "sum":
        result = col.sum()
    elif agg == "average" or agg == "mean":
        result = col.mean()
    elif agg == "min":
        result = col.min()
    elif agg == "max":
        result = col.max()
    elif agg == "median":
        result = col.median()
    elif agg == "std":
        result = col.std()
    elif agg == "var":
        result = col.var()
    elif agg == "count":
        result = col.notna().astype(int)
    elif agg == "count_distinct":
        result = col.nunique()
    elif agg == "first":
        result = col.iloc[0] if len(col) > 0 else None
    elif agg == "last":
        result = col.iloc[-1] if len(col) > 0 else None
    elif agg == "rank_asc":
        result = col.rank(ascending=True).astype(int)
    elif agg == "rank_desc":
        result = col.rank(ascending=False).astype(int)
    else:
        result = pd.Series([np.nan] * len(col))
    return result.round(decimals)


def _get_agg_func(agg: str):
    """Get aggregation function from AGG_MAP."""
    return getattr(pd.Series, AGG_MAP.get(agg, "sum"), None)


# ─── Post-calculations ──────────────────────────────────────────────

def _calculate_postcalcs(series: pd.Series, pct_type: str, reference: pd.Series, dec: int) -> pd.Series:
    """Calculate percentage changes or point changes."""
    if pct_type == "pct_grand":
        total = reference.sum()
        if total != 0:
            return ((series / total) * 100).round(dec)
    elif pct_type == "pct_row":
        if len(series) > 0 and len(reference) > 0:
            reference = reference.iloc[:len(series)]
            return ((series / reference) * 100).round(dec)
    elif pct_type == "pct_parent_col":
        parent_col = pct_type.split("_")[-1]
        if parent_col in series.index and len(reference) > 0:
            reference = reference[parent_col]
            return ((series / reference) * 100).round(dec)
    elif pct_type == "pct_parent_row":
        parent_row = int(pct_type.split("_")[-1])
        if 0 <= parent_row < len(series) and 0 <= parent_row < len(reference):
            parent_val = series.iloc[parent_row - 1] if parent_row > 0 else 0
            ref_val = reference.iloc[parent_row - 1] if parent_row > 0 else 0
            return ((parent_val - ref_val) / (parent_val if parent_val != 0 else 1) * 100).round(dec)
    elif pct_type == "pct_col":
        # Column total share within row: (value / sum of row) * 100
        return ((series / series.sum(axis=1)) * 100).round(dec)
    elif pct_type == "change_vs_prev":
        shifted = series.shift(1)
        non_na_shifted = shifted.dropna()
        non_na_series = series.dropna()
        total = non_na_series.sum()
        if total != 0:
            return ((non_na_series - non_na_shifted) / total * 100).round(dec)
    elif pct_type == "z_score":
        mean = series.mean()
        std = series.std()
        if std and std != 0:
            n = series.count()
            z = abs((series - mean) / std)
            from scipy.stats import norm
            p = 2 * (1 - norm.cdf(z)) if n > 30 else norm.cdf(z)
            return f"{z:.2f}"
        return np.nan


# ─── Pivot Table Generation ────────────────────────────────────────────

def _generate_pivot(df: pd.DataFrame, config: TableConfig) -> pd.DataFrame:
    """Generate a pivot table from the configuration."""
    rows = config.rows if config.rows else []
    cols = config.columns if config.columns else []

    if not rows:
        raise HTTPException(400, "No row grouping configured")

    # Handle grand total configuration
    if config.grand_total and len(rows) > 1:
        df["_grand_total"] = 1
        if config.grand_total_columns and len(cols) > 0:
            grand_cols = [c for c in cols if c not in config.grand_total_columns or c in rows]
        else:
            grand_cols = cols
    else:
        df = df.drop(columns=["_grand_total"], errors="ignore")

    # Determine aggregation function
    agg_func = _get_agg_func(config.subtotals)

    # Filter dataframe
    filter_mask = pd.Series([True] * len(df), index=df.index)
    for col, vals in config.filters.items():
        if col in df.columns:
            if vals:
                if col in df.columns:
                    df[col] = df[col].astype(str).isin([str(v) for v in vals])
            else:
                filter_mask = df[col].notna() & (df[col] != "")

    df_filtered = df[filter_mask].reset_index(drop=True)

    # Clean NaT/NaN for groupby/pivot fields to prevent index errors
    _nan_strs = {'nan', 'NaN', 'None', 'NaT', '', '<NA>'}
    for gc in rows + cols:
        if gc in df_filtered.columns:
            df_filtered[gc] = df_filtered[gc].fillna("").astype(str)
            df_filtered = df_filtered.replace(_nan_strs, np.nan)

    # Handle blank suppression
    if config.blank_suppress:
        # Check if all configured value columns are 0/blank
        value_cols = [c for c in cols if c not in config.filters]
        if value_cols:
            # Create a mask where ANY value column is 0/blank
            blank_mask = df_filtered[value_cols].ne(axis=1).any(axis=1)
            df_filtered = df_filtered[~blank_mask].reset_index(drop=True)

    # Group by rows (including subtotals)
    if config.subtotals and len(rows) > 1:
        # Add temporary columns for hierarchical labels
        df_filtered["_group_label"] = df_filtered[rows[-1]]
        result = df_filtered.groupby(rows + ["_group_label"] + cols, dropna=False)
    else:
        result = df_filtered.groupby(rows + cols, dropna=False)

    # Apply aggregation
    agg_values = config.values
    result_agg = {}
    for agg in agg_values:
        for val_col in agg:
            if val_col in result_agg:
                agg_func = _get_agg_func(agg["agg"])
                result_agg[val_col] = agg_func(result_agg[val_col])
                dec = agg.get("decimals", 2)
                result_agg[val_col] = _agg_value(result_agg[val_col], agg["agg"], dec)

    # Apply post-calculations
    for pc in config.values:
        if pc["agg"]:
            dec = pc.get("decimals", 2)
            for v in result_agg:
                result_agg[v] = _calculate_postcalcs(result_agg[v], pc["pct_type"], result_agg[pc.get("value_column", "")], dec)
        elif pc["agg"]:
            dec = pc.get("decimals", 2)
            for v in result_agg:
                result_agg[v] = _calculate_postcalcs(result_agg[v], "pct_col", result_agg[pc.get("value_column", "")], dec)

    # Handle multi-sort (multiple sort columns in specified order)
    if config.multi_sort:
        sort_asc = [sk["order"] == "asc" for sk in config.multi_sort if sk.get("field") in result_agg.columns]
        result_agg = result_agg.sort_values(by=[k["field"] for k in config.multi_sort], ascending=sort_asc)

    # Single column sort
    elif config.sort_by:
        result_agg = result_agg.sort_values(by=config.sort_by, ascending=(config.sort_order == "asc"))

    # Reset index and clean up index name
    result_agg = result_agg.reset_index(drop=True)

    # Clean display columns (remove internal grouping columns)
    display_cols = [c for c in result_agg.columns if c not in rows and c != "_group_label"]
    result_agg = result_agg[display_cols]

    # Format numeric columns with grouping
    for col in display_cols:
        if result_agg[col].dtype in (np.integer, np.floating):
            # Round numeric columns to 2 decimal places
            result_agg[col] = result_agg[col].apply(lambda x: round(float(x), 2) if pd.notna(x) else x)

    return result_agg


# ─── Tabulation Endpoint ────────────────────────────────────────────────

@router.post("/api/tabulate")
async def tabulate(config: TableConfig):
    """Generate a tabulated result based on the provided configuration."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[config.dataset_id]["df"].copy()
    add_audit_log(config.dataset_id, "tabulation", f"Generated table with {len(config.rows)} row(s), {len(config.columns)} column(s)")

    pivot_df = _generate_pivot(df, config)

    return {
        "headers": pivot_df.columns.tolist(),
        "rows": pivot_df.to_dict(orient="records"),
        "row_count": len(pivot_df),
    }
