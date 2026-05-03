"""Utility functions shared across modules."""

import re as _re
import pandas as pd
import numpy as np
from datetime import datetime
import traceback

def _is_multi_choice(series: pd.Series) -> bool:
    """Detect if a column contains multi-choice comma-separated values like '1,2' or '2,4,5'."""
    non_null = series.dropna().astype(str)
    non_null = non_null[~non_null.isin(['nan', 'NaN', 'None', ''])]
    if len(non_null) == 0:
        return False
    if len(non_null) > 500:
        sample = non_null.sample(500, random_state=42)
    else:
        sample = non_null
    multi_count = 0
    for val in sample:
        val = val.strip()
        if ',' in val:
            parts = [p.strip() for p in val.split(',')]
            if all(len(p) <= 20 and len(p) > 0 for p in parts):
                multi_count += 1
    return multi_count >= 2 or (multi_count >= 1 and multi_count > len(sample) * 0.02)

def _detect_columns(df: pd.DataFrame) -> list:
    """Detect column types and return metadata."""
    columns = []
    for col in df.columns:
        dtype = str(df[col].dtype)
        is_multi = False
        if "int" in dtype or "float" in dtype:
            col_type = "numeric"
        elif "datetime" in dtype:
            col_type = "date"
        elif "bool" in dtype:
            col_type = "boolean"
        else:
            if df[col].dropna().shape[0] > 0:
                is_multi = _is_multi_choice(df[col])
                if is_multi:
                    col_type = "multi_choice"
                else:
                    try:
                        pd.to_numeric(df[col].dropna().head(20))
                        col_type = "numeric"
                        df[col] = pd.to_numeric(df[col], errors="coerce")
                    except (ValueError, TypeError):
                        sample_str = df[col].dropna().head(20).astype(str)
                        if sample_str.str.contains(r'[-/:]', regex=True).any():
                            try:
                                pd.to_datetime(sample_str)
                                col_type = "date"
                            except (ValueError, TypeError):
                                col_type = "text"
                        else:
                            col_type = "text"
            else:
                col_type = "text"
        sample_values = [str(v) for v in df[col].dropna().head(10).tolist()]
        stats = {}
        if col_type == "numeric":
            try:
                num_series = pd.to_numeric(df[col], errors="coerce") if df[col].dtype == object else df[col]
                stats = {
                    "min": float(num_series.min()) if not pd.isna(num_series.min()) else None,
                    "max": float(num_series.max()) if not pd.isna(num_series.max()) else None,
                    "mean": float(num_series.mean()) if not pd.isna(num_series.mean()) else None,
                }
            except Exception:
                stats = {"min": None, "max": None, "mean": None}
        stats["nulls"] = int(df[col].isna().sum())
        stats["unique"] = int(df[col].nunique())
        if is_multi:
            all_vals = []
            for v in df[col].dropna().astype(str):
                all_vals.extend([p.strip() for p in v.split(',') if p.strip()])
            stats["unique_responses"] = len(set(all_vals))
            stats["total_responses"] = len(all_vals)
            stats["is_multi_choice"] = True
        columns.append({
            "name": col,
            "type": col_type,
            "sample_values": sample_values,
            "stats": stats,
        })
    return columns

def apply_metrics_and_bins(df: pd.DataFrame, dataset_id: str, tables=None):
    """Calculate metrics and apply custom bins for all value columns."""
    from .state import custom_metrics, custom_bins, sanitize_for_json, add_audit_log

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
            try:
                if _is_multi_choice(df[col]):
                    col_type = "multi_choice"
            except Exception:
                pass

        if col_type in ["numeric", "date", "boolean", "multi_choice"]:
            if dataset_id in custom_bins and col in custom_bins[dataset_id]:
                bin_def = next((b for b in custom_bins[dataset_id] if b["column_name"] == col), None)
            else:
                # Simple auto-bins for numeric columns
                if col_type == "numeric":
                    bin_def = {"column_name": col, "bins": [0, 25, 50, 100, 500, 1000], "labels": ["0-25", "25-50", "50-100", "100-500", "500-1k", "1k+"]}

            if dataset_id in custom_metrics:
                metric_def = next((m for m in custom_metrics[dataset_id] if m["column_name"] == col), None)

    return col_type, bin_def if 'bin_def' in locals() else None, metric_def if 'metric_def' in locals() else None

def traceback_print_exc():
    """Print exception traceback for debugging."""
    traceback.print_exc()
