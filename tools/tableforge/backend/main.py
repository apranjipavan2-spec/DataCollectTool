"""TableForge Backend - FastAPI server for data processing and tabulation."""

import os
import io
import json
import uuid
import traceback
from pathlib import Path
from typing import Optional
from datetime import datetime

import pandas as pd
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="TableForge", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory stores
datasets: dict = {}
custom_metrics: dict = {}  # dataset_id -> [metric_defs]
custom_bins: dict = {}     # dataset_id -> [bin_defs]
audit_logs: dict = {}      # dataset_id -> [log_entries]
annotations: dict = {}     # dataset_id -> {table_id -> [{row, col, text, color}]}
upload_progress: dict = {}  # dataset_id -> {percent, rows_read, total_estimated, status}
column_type_overrides: dict = {}  # dataset_id -> {col_name: "text"|"numeric"|"multi_choice"|"date"}

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECTS_DIR = BASE_DIR / "projects"
EXPORTS_DIR = BASE_DIR / "exports"
CACHE_DIR = BASE_DIR / "cache"
METRICS_DIR = BASE_DIR / "metrics"
LIBRARY_DIR = BASE_DIR / "library"
PARQUET_DIR = BASE_DIR / "parquet_cache"

for d in [PROJECTS_DIR, EXPORTS_DIR, CACHE_DIR, METRICS_DIR, LIBRARY_DIR, PARQUET_DIR]:
    d.mkdir(exist_ok=True)

LARGE_FILE_THRESHOLD = 50 * 1024 * 1024  # 50 MB — use chunked reading above this

SUPER_ADMIN_ROLE = "master_admin"


def get_user_projects_dir(user_id: Optional[str]) -> Path:
    """Get the user-scoped projects directory. Falls back to shared dir if no user."""
    if user_id:
        user_dir = PROJECTS_DIR / user_id
        user_dir.mkdir(exist_ok=True)
        return user_dir
    return PROJECTS_DIR


def is_super_admin(role: Optional[str]) -> bool:
    return role == SUPER_ADMIN_ROLE
MEMORY_LIMIT = 500 * 1024 * 1024  # 500 MB — sample/page data above this


def sanitize_for_json(obj):
    """Recursively replace NaN/Infinity with None in nested structures."""
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_for_json(v) for v in obj]
    if isinstance(obj, float):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return obj
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return float(obj)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, pd.Timestamp):
        if pd.isna(obj):
            return None
        return obj.isoformat()
    if isinstance(obj, pd.Period):
        return str(obj)
    if isinstance(obj, np.ndarray):
        return sanitize_for_json(obj.tolist())
    if pd.isna(obj) if not isinstance(obj, (str, list, dict)) else False:
        return None
    return obj


def add_audit_log(dataset_id: str, action: str, details: str = ""):
    """Add an entry to the audit trail."""
    if dataset_id not in audit_logs:
        audit_logs[dataset_id] = []
    audit_logs[dataset_id].append({
        "timestamp": datetime.now().isoformat(),
        "action": action,
        "details": details,
    })


# ═══════════════════════════════════════════════════
# Module A: File Upload & Data Ingestion
# ═══════════════════════════════════════════════════

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload an Excel or CSV file and return dataset metadata."""
    dataset_id = str(uuid.uuid4())
    filename = file.filename or "unknown"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    tmp_path = CACHE_DIR / f"{dataset_id}.{ext}"
    content = await file.read()
    tmp_path.write_bytes(content)

    file_size = len(content)
    is_large_file = file_size > LARGE_FILE_THRESHOLD

    try:
        if ext in ("xlsx", "xls"):
            xls = pd.ExcelFile(tmp_path, engine="openpyxl" if ext == "xlsx" else "xlrd")
            sheets = xls.sheet_names
            df = pd.read_excel(xls, sheet_name=sheets[0])
        elif ext in ("csv", "tsv"):
            sep = "\t" if ext == "tsv" else ","
            df = None
            for enc in ["utf-8", "latin-1", "cp1252", "iso-8859-1"]:
                try:
                    if is_large_file:
                        # Chunked reading for large files
                        chunks = []
                        reader = pd.read_csv(tmp_path, sep=sep, encoding=enc, chunksize=100_000)
                        for chunk in reader:
                            chunks.append(chunk)
                        df = pd.concat(chunks, ignore_index=True)
                    else:
                        df = pd.read_csv(tmp_path, sep=sep, encoding=enc)
                    break
                except UnicodeDecodeError:
                    continue
            if df is None:
                df = pd.read_csv(tmp_path, sep=sep, encoding="utf-8", errors="replace")
        else:
            raise HTTPException(400, f"Unsupported file format: .{ext}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Failed to read file: {str(e)}")

    # Cache large DataFrames as parquet for fast re-reads
    if is_large_file:
        try:
            parquet_path = PARQUET_DIR / f"{dataset_id}.parquet"
            df.to_parquet(parquet_path, index=False)
        except Exception:
            pass  # parquet cache is optional

    # Detect column types
    columns = []
    for col in df.columns:
        dtype = str(df[col].dtype)
        if "int" in dtype or "float" in dtype:
            col_type = "numeric"
        elif "datetime" in dtype:
            col_type = "date"
        elif "bool" in dtype:
            col_type = "boolean"
        else:
            is_mc = False
            if df[col].dropna().shape[0] > 0:
                # Check for multi-choice (comma-separated values like "1,2" or "3,4,5") FIRST
                # before any numeric conversion that would destroy comma-separated strings
                try:
                    is_mc = _is_multi_choice(df[col])
                except Exception:
                    is_mc = False
                if is_mc:
                    col_type = "multi_choice"
                else:
                    # Try numeric first (to avoid small ints being parsed as dates)
                    try:
                        pd.to_numeric(df[col].dropna().head(20))
                        col_type = "numeric"
                        df[col] = pd.to_numeric(df[col], errors="coerce")
                    except (ValueError, TypeError):
                        # Try date — but only if values look like date strings, not plain numbers
                        sample_str = df[col].dropna().head(20).astype(str)
                        has_date_chars = sample_str.str.contains(r'[-/:]', regex=True).any()
                        if has_date_chars:
                            try:
                                pd.to_datetime(sample_str)
                                col_type = "date"
                                df[col] = pd.to_datetime(df[col], errors="coerce")
                            except (ValueError, TypeError):
                                col_type = "text"
                        else:
                            col_type = "text"
            else:
                col_type = "text"

        sample_values = df[col].dropna().head(10).tolist()
        stats = {}
        if col_type == "numeric":
            stats = {
                "min": float(df[col].min()) if not pd.isna(df[col].min()) else None,
                "max": float(df[col].max()) if not pd.isna(df[col].max()) else None,
                "mean": float(df[col].mean()) if not pd.isna(df[col].mean()) else None,
            }
        stats["nulls"] = int(df[col].isna().sum())
        stats["unique"] = int(df[col].nunique())
        if col_type == "multi_choice":
            all_mc_vals: list = []
            for mv in df[col].dropna().astype(str):
                all_mc_vals.extend([p.strip() for p in mv.split(',') if p.strip()])
            stats["unique_responses"] = len(set(all_mc_vals))
            stats["total_responses"] = len(all_mc_vals)
            stats["is_multi_choice"] = True

        columns.append({
            "name": col,
            "type": col_type,
            "sample_values": [str(v) for v in sample_values],
            "stats": sanitize_for_json(stats),
        })

    datasets[dataset_id] = {
        "df": df,
        "filename": filename,
        "sheets": sheets if ext in ("xlsx", "xls") else [filename],
    }
    custom_metrics[dataset_id] = []
    custom_bins[dataset_id] = []
    audit_logs[dataset_id] = []
    annotations[dataset_id] = {}
    column_type_overrides[dataset_id] = {}
    add_audit_log(dataset_id, "file_import", f"Imported {filename}: {len(df)} rows, {len(df.columns)} columns")

    return {
        "dataset_id": dataset_id,
        "filename": filename,
        "sheets": datasets[dataset_id]["sheets"],
        "row_count": len(df),
        "is_large_file": is_large_file,
        "file_size_mb": round(file_size / 1024 / 1024, 1),
        "columns": columns,
        "preview": sanitize_for_json(df.head(50).fillna("").to_dict(orient="records")),
    }


# ─── Sheet Selection ───

class SheetSelect(BaseModel):
    dataset_id: str
    sheet_name: str

@app.post("/api/upload/sheet")
async def load_sheet(req: SheetSelect):
    """Load a specific sheet from a previously uploaded workbook."""
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    ext = datasets[req.dataset_id]["filename"].rsplit(".", 1)[-1].lower()
    tmp_path = CACHE_DIR / f"{req.dataset_id}.{ext}"
    df = pd.read_excel(tmp_path, sheet_name=req.sheet_name)
    datasets[req.dataset_id]["df"] = df
    add_audit_log(req.dataset_id, "sheet_change", f"Switched to sheet: {req.sheet_name}")

    columns = _detect_columns(df)
    return {"row_count": len(df), "columns": columns,
            "preview": sanitize_for_json(df.head(50).fillna("").to_dict(orient="records"))}


def _is_multi_choice(series: pd.Series) -> bool:
    """Detect if a column contains multi-choice comma-separated values like '1,2' or '2,4,5'."""
    non_null = series.dropna().astype(str)
    non_null = non_null[~non_null.isin(['nan', 'NaN', 'None', ''])]
    if len(non_null) == 0:
        return False
    # Sample up to 500 rows spread across the dataset for better detection
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
    # Even a few multi-choice values (>2% or at least 2) should trigger detection
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
                # Check for multi-choice before converting types
                is_multi = _is_multi_choice(df[col])
                if is_multi:
                    col_type = "multi_choice"
                else:
                    # Try numeric first (avoid small ints → date)
                    try:
                        pd.to_numeric(df[col].dropna().head(20))
                        col_type = "numeric"
                        df[col] = pd.to_numeric(df[col], errors="coerce")
                    except (ValueError, TypeError):
                        # Try date — only if values contain date-like characters
                        _samp = df[col].dropna().head(20).astype(str)
                        if _samp.str.contains(r'[-/:]', regex=True).any():
                            try:
                                pd.to_datetime(_samp)
                                col_type = "date"
                            except (ValueError, TypeError):
                                col_type = "text"
                        else:
                            col_type = "text"
            else:
                col_type = "text"
        sample_values = df[col].dropna().head(10).tolist()
        stats = {}
        if col_type == "numeric":
            try:
                num_series = pd.to_numeric(df[col], errors="coerce") if df[col].dtype == object else df[col]
                stats = {"min": float(num_series.min()) if not pd.isna(num_series.min()) else None,
                         "max": float(num_series.max()) if not pd.isna(num_series.max()) else None,
                         "mean": float(num_series.mean()) if not pd.isna(num_series.mean()) else None}
            except Exception:
                stats = {"min": None, "max": None, "mean": None}
        stats["nulls"] = int(df[col].isna().sum())
        stats["unique"] = int(df[col].nunique())
        if is_multi:
            # Count total unique individual responses
            all_vals = []
            for v in df[col].dropna().astype(str):
                all_vals.extend([p.strip() for p in v.split(',') if p.strip()])
            stats["unique_responses"] = len(set(all_vals))
            stats["total_responses"] = len(all_vals)
            stats["is_multi_choice"] = True
        columns.append({"name": col, "type": col_type, "sample_values": [str(v) for v in sample_values],
                        "stats": sanitize_for_json(stats)})
    return columns


# ─── Column Rename / Exclude ───

class ColumnOps(BaseModel):
    dataset_id: str
    renames: dict = {}          # {"old_name": "new_name"}
    exclude_columns: list[str] = []
    exclude_rows: list[int] = []  # row indices to exclude
    header_row: Optional[int] = None  # manual header row override

@app.post("/api/dataset/modify")
async def modify_dataset(ops: ColumnOps):
    """Rename columns, exclude rows/columns, set header row."""
    if ops.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[ops.dataset_id]["df"]

    # Header row override
    if ops.header_row is not None and ops.header_row > 0:
        ext = datasets[ops.dataset_id]["filename"].rsplit(".", 1)[-1].lower()
        tmp_path = CACHE_DIR / f"{ops.dataset_id}.{ext}"
        if ext in ("xlsx", "xls"):
            df = pd.read_excel(tmp_path, header=ops.header_row)
        elif ext in ("csv", "tsv"):
            sep = "\t" if ext == "tsv" else ","
            df = pd.read_csv(tmp_path, sep=sep, header=ops.header_row)

    # Exclude rows
    if ops.exclude_rows:
        df = df.drop(index=[i for i in ops.exclude_rows if i in df.index]).reset_index(drop=True)

    # Exclude columns
    if ops.exclude_columns:
        df = df.drop(columns=[c for c in ops.exclude_columns if c in df.columns], errors="ignore")

    # Rename columns
    if ops.renames:
        df = df.rename(columns=ops.renames)

    datasets[ops.dataset_id]["df"] = df
    details = []
    if ops.renames: details.append(f"Renamed {len(ops.renames)} columns")
    if ops.exclude_columns: details.append(f"Excluded {len(ops.exclude_columns)} columns")
    if ops.exclude_rows: details.append(f"Excluded {len(ops.exclude_rows)} rows")
    add_audit_log(ops.dataset_id, "data_modify", "; ".join(details))

    columns = _detect_columns(df)
    return {"row_count": len(df), "columns": columns,
            "preview": sanitize_for_json(df.head(50).fillna("").to_dict(orient="records"))}


# ─── Column Type Override ───

class ColumnTypeReq(BaseModel):
    dataset_id: str
    column: str
    new_type: str  # "text", "numeric", "multi_choice", "date"

@app.post("/api/dataset/column_type")
async def set_column_type(req: ColumnTypeReq):
    """Override the detected data type for a specific column."""
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[req.dataset_id]["df"]
    if req.column not in df.columns:
        raise HTTPException(404, f"Column '{req.column}' not found")

    if req.dataset_id not in column_type_overrides:
        column_type_overrides[req.dataset_id] = {}
    column_type_overrides[req.dataset_id][req.column] = req.new_type

    current_dtype = str(df[req.column].dtype)

    if req.new_type == "numeric":
        datasets[req.dataset_id]["df"][req.column] = pd.to_numeric(df[req.column], errors="coerce")
    elif req.new_type in ("text", "multi_choice"):
        # If column was previously converted to numeric, reload raw strings from cache
        if "float" in current_dtype or "int" in current_dtype:
            filename = datasets[req.dataset_id]["filename"]
            ext = filename.rsplit(".", 1)[-1].lower()
            cache_path = CACHE_DIR / f"{req.dataset_id}.{ext}"
            reloaded = False
            if cache_path.exists():
                try:
                    if ext in ("xlsx", "xls"):
                        raw_df = pd.read_excel(cache_path, dtype={req.column: str})
                    else:
                        sep = "\t" if ext == "tsv" else ","
                        raw_df = pd.read_csv(cache_path, sep=sep, dtype={req.column: str})
                    if req.column in raw_df.columns:
                        datasets[req.dataset_id]["df"][req.column] = raw_df[req.column]
                        reloaded = True
                except Exception:
                    pass
            if not reloaded:
                # Fallback: convert existing floats to ints then strings when possible
                datasets[req.dataset_id]["df"][req.column] = (
                    df[req.column].apply(
                        lambda x: str(int(x)) if pd.notna(x) and x == int(x) else str(x) if pd.notna(x) else ""
                    )
                )
    elif req.new_type == "date":
        try:
            datasets[req.dataset_id]["df"][req.column] = pd.to_datetime(df[req.column], errors="coerce")
        except Exception:
            pass

    add_audit_log(req.dataset_id, "column_type_change", f"Changed '{req.column}' to {req.new_type}")
    return {"status": "ok", "column": req.column, "new_type": req.new_type}


# ─── Multi-Sheet Union ───

class UnionConfig(BaseModel):
    dataset_id: str
    sheet_names: list[str]

@app.post("/api/upload/union")
async def union_sheets(config: UnionConfig):
    """Combine multiple sheets into one dataset."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    ext = datasets[config.dataset_id]["filename"].rsplit(".", 1)[-1].lower()
    tmp_path = CACHE_DIR / f"{config.dataset_id}.{ext}"
    frames = []
    for sheet in config.sheet_names:
        try:
            frames.append(pd.read_excel(tmp_path, sheet_name=sheet))
        except Exception:
            pass
    if not frames:
        raise HTTPException(400, "No valid sheets to union")
    df = pd.concat(frames, ignore_index=True)
    datasets[config.dataset_id]["df"] = df
    add_audit_log(config.dataset_id, "sheet_union", f"Combined sheets: {', '.join(config.sheet_names)}")
    columns = _detect_columns(df)
    return {"row_count": len(df), "columns": columns,
            "preview": sanitize_for_json(df.head(50).fillna("").to_dict(orient="records"))}


# ─── Data Refresh ───

@app.post("/api/dataset/{dataset_id}/refresh")
async def refresh_dataset(dataset_id: str):
    """Reload the source file without losing configuration."""
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    filename = datasets[dataset_id]["filename"]
    ext = filename.rsplit(".", 1)[-1].lower()
    tmp_path = CACHE_DIR / f"{dataset_id}.{ext}"
    if not tmp_path.exists():
        raise HTTPException(404, "Source file no longer cached")
    try:
        if ext in ("xlsx", "xls"):
            df = pd.read_excel(tmp_path)
        else:
            df = pd.read_csv(tmp_path)
        datasets[dataset_id]["df"] = df
        add_audit_log(dataset_id, "data_refresh", f"Reloaded {filename}")
        columns = _detect_columns(df)
        return {"row_count": len(df), "columns": columns}
    except Exception as e:
        raise HTTPException(400, f"Refresh failed: {str(e)}")


# ═══════════════════════════════════════════════════
# Module C: Tabulation & Calculation Engine
# ═══════════════════════════════════════════════════

class TableConfig(BaseModel):
    dataset_id: str
    rows: list[str] = []
    columns: list[str] = []
    values: list[dict] = []
    filters: dict = {}
    subtotals: bool = False
    subtotals_position: str = "bottom"
    grand_total: bool = True
    grand_total_rows: Optional[bool] = None    # None = follow grand_total
    grand_total_columns: Optional[bool] = None # None = follow grand_total
    sort_by: Optional[str] = None
    sort_order: str = "asc"
    multi_sort: list[dict] = []     # [{field, order}] for multi-key sorting
    custom_sort_orders: dict = {}   # {field: [cat1, cat2, ...]} for manual category ordering
    missing_data: str = ""
    date_groupings: dict = {}       # {col_name: "year"|"quarter"|"month"|"week"|"day"}
    blank_suppress: bool = False    # hide rows where all value cols are 0/blank


AGG_MAP = {
    "sum": "sum", "count": "count", "average": "mean", "mean": "mean",
    "min": "min", "max": "max", "median": "median",
    "std": "std", "var": "var",
    "count_distinct": "nunique", "first": "first", "last": "last",
}

PERCENT_AGGS = {"pct_grand", "pct_row", "pct_col", "pct_parent_row", "pct_parent_col"}
SPECIAL_AGGS = {"running_total", "cumulative_sum", "rank_asc", "rank_desc", "index"}
# Aggregations that require numeric values — auto-downgrade to 'count' for text/multi-choice columns
NUMERIC_ONLY_AGGS = {"sum", "average", "mean", "min", "max", "median", "std", "var"}


def _col_is_text(df: pd.DataFrame, col_name: str) -> bool:
    """Return True if the column is textual/categorical (not truly numeric)."""
    if col_name not in df.columns:
        return False
    dtype = str(df[col_name].dtype)
    if dtype != 'object':
        return False  # Already numeric/date/bool — fine
    # dtype is object (string). Check if values are actually numeric strings.
    sample = df[col_name].dropna().head(50)
    if len(sample) == 0:
        return False
    try:
        pd.to_numeric(sample, errors='raise')
        return False  # Values look numeric — allow numeric aggs
    except (ValueError, TypeError):
        return True  # Truly text — only count/count_distinct make sense


def apply_metrics_and_bins(df: pd.DataFrame, dataset_id: str) -> pd.DataFrame:
    """Apply custom metrics and bins to the dataframe."""
    # Apply bins first
    for bdef in custom_bins.get(dataset_id, []):
        src = bdef["source_column"]
        name = bdef["name"]
        if src not in df.columns:
            continue
        btype = bdef["bin_type"]

        if btype == "numeric":
            qt = bdef.get("quantile_type", "equal_width")
            if qt in ("equal_freq", "quartile", "decile"):
                n = bdef.get("num_bins", 4 if qt == "quartile" else 10)
                try:
                    df[name] = pd.qcut(df[src], q=n, duplicates="drop").astype(str)
                except Exception:
                    df[name] = df[src].astype(str)
            else:
                ranges = bdef.get("ranges", [])
                if ranges:
                    lower_inclusive = bdef.get("lower_inclusive", True)
                    upper_inclusive = bdef.get("upper_inclusive", False)
                    remainder_label = bdef.get("remainder_label")
                    edges = [r["lower"] for r in ranges] + [ranges[-1]["upper"]]
                    labels = [r["label"] for r in ranges]
                    # right=True means (lower, upper], right=False means [lower, upper)
                    right = upper_inclusive and not lower_inclusive
                    try:
                        cut_result = pd.cut(df[src], bins=edges, labels=labels, right=right, include_lowest=lower_inclusive)
                        if remainder_label:
                            df[name] = cut_result.astype(str).replace("nan", remainder_label)
                        else:
                            df[name] = cut_result.astype(str)
                    except Exception:
                        df[name] = df[src].astype(str)
        elif btype == "date":
            freq = bdef.get("frequency", "month")
            if freq == "fiscal_year":
                fy_start = bdef.get("fiscal_start_month", 4)
                try:
                    col_dt = pd.to_datetime(df[src], errors="coerce")
                    df[name] = col_dt.apply(lambda d: f"FY{d.year if d.month >= fy_start else d.year - 1}" if pd.notna(d) else None)
                except Exception:
                    df[name] = df[src].astype(str)
            else:
                freq_map = {"year": "YE", "quarter": "QE", "month": "ME", "week": "W", "day": "D"}
                try:
                    col_dt = pd.to_datetime(df[src], errors="coerce")
                    df[name] = col_dt.dt.to_period(freq_map.get(freq, "ME")).astype(str)
                except Exception:
                    df[name] = df[src].astype(str)
        elif btype == "date_range":
            date_ranges = bdef.get("date_ranges", [])
            remainder_label = bdef.get("remainder_label")
            try:
                col_dt = pd.to_datetime(df[src], errors="coerce")
                def classify_date(d):
                    if pd.isna(d):
                        return remainder_label or "Unknown"
                    for dr in date_ranges:
                        label = dr.get("label", "")
                        start_s = dr.get("start", "")
                        end_s = dr.get("end", "")
                        start = pd.to_datetime(start_s) if start_s else pd.Timestamp.min
                        end = pd.to_datetime(end_s) if end_s else pd.Timestamp.max
                        if start <= d <= end:
                            return label
                    return remainder_label or "Other"
                df[name] = col_dt.apply(classify_date)
            except Exception:
                df[name] = df[src].astype(str)
        elif btype == "text":
            case_norm = bdef.get("case_normalize", "none")
            mapping = bdef.get("mapping", {})
            src_series = df[src].astype(str)
            if case_norm == "lower":
                src_series = src_series.str.lower()
                mapping = {k.lower(): v for k, v in mapping.items()}
            elif case_norm == "upper":
                src_series = src_series.str.upper()
                mapping = {k.upper(): v for k, v in mapping.items()}
            elif case_norm == "title":
                src_series = src_series.str.title()
                mapping = {k.title(): v for k, v in mapping.items()}
            df[name] = src_series.map(mapping).fillna(src_series)
        elif btype == "regex":
            import re
            patterns = bdef.get("regex_patterns", [])
            def apply_regex(val):
                s = str(val) if pd.notna(val) else ""
                for p in patterns:
                    try:
                        if re.match(p["pattern"], s):
                            return p["label"]
                    except re.error:
                        pass
                return s
            df[name] = df[src].apply(apply_regex)
        elif btype == "group":
            group_map = bdef.get("group_map", {})
            case_norm = bdef.get("case_normalize", "none")
            remainder_label = bdef.get("remainder_label")
            # Invert: value → group label
            inv = {}
            for label, values in group_map.items():
                for v in values:
                    inv[str(v).strip()] = label
            src_series = df[src].astype(str)
            if case_norm == "lower": src_series = src_series.str.lower(); inv = {k.lower(): v for k, v in inv.items()}
            elif case_norm == "upper": src_series = src_series.str.upper(); inv = {k.upper(): v for k, v in inv.items()}
            elif case_norm == "title": src_series = src_series.str.title(); inv = {k.title(): v for k, v in inv.items()}
            if remainder_label:
                df[name] = src_series.map(inv).fillna(remainder_label)
            else:
                df[name] = src_series.map(inv).fillna(src_series)
        elif btype == "relative_date":
            freq = bdef.get("frequency", "last_30d")
            try:
                from datetime import date, timedelta
                today = pd.Timestamp.now().normalize()
                col_dt = pd.to_datetime(df[src], errors="coerce")
                if freq == "last_7d":
                    cutoff = today - pd.Timedelta(days=7)
                    df[name] = col_dt.apply(lambda d: "In Period" if pd.notna(d) and d >= cutoff else "Prior Period")
                elif freq == "last_30d":
                    cutoff = today - pd.Timedelta(days=30)
                    df[name] = col_dt.apply(lambda d: "In Period" if pd.notna(d) and d >= cutoff else "Prior Period")
                elif freq == "last_90d":
                    cutoff = today - pd.Timedelta(days=90)
                    df[name] = col_dt.apply(lambda d: "In Period" if pd.notna(d) and d >= cutoff else "Prior Period")
                elif freq == "last_12m":
                    cutoff = today - pd.DateOffset(months=12)
                    df[name] = col_dt.apply(lambda d: "In Period" if pd.notna(d) and d >= cutoff else "Prior Period")
                elif freq == "ytd":
                    start = pd.Timestamp(today.year, 1, 1)
                    df[name] = col_dt.apply(lambda d: "YTD" if pd.notna(d) and d >= start else "Prior")
                elif freq == "last_year":
                    start = pd.Timestamp(today.year - 1, 1, 1)
                    end = pd.Timestamp(today.year - 1, 12, 31)
                    df[name] = col_dt.apply(lambda d: "Last Year" if pd.notna(d) and start <= d <= end else "Other")
                elif freq == "qtd":
                    qstart = pd.Timestamp(today.year, ((today.month - 1) // 3) * 3 + 1, 1)
                    df[name] = col_dt.apply(lambda d: "QTD" if pd.notna(d) and d >= qstart else "Prior")
                elif freq == "mtd":
                    mstart = pd.Timestamp(today.year, today.month, 1)
                    df[name] = col_dt.apply(lambda d: "MTD" if pd.notna(d) and d >= mstart else "Prior")
                else:
                    df[name] = "In Period"
            except Exception:
                df[name] = df[src].astype(str)

    # Apply metrics
    for mdef in custom_metrics.get(dataset_id, []):
        name = mdef["name"]
        mtype = mdef["metric_type"]
        try:
            if mtype == "formula":
                col_a = mdef["column_a"]
                col_b = mdef.get("column_b")
                op = mdef["operator"]
                if op == "+" and col_b:
                    df[name] = df[col_a] + df[col_b]
                elif op == "-" and col_b:
                    df[name] = df[col_a] - df[col_b]
                elif op == "*" and col_b:
                    df[name] = df[col_a] * df[col_b]
                elif op == "/" and col_b:
                    df[name] = df[col_a] / df[col_b].replace(0, np.nan)
            elif mtype == "ratio":
                num = mdef["numerator"]
                den = mdef["denominator"]
                df[name] = df[num] / df[den].replace(0, np.nan)
            elif mtype == "percentage":
                part = mdef["part"]
                whole = mdef["whole"]
                df[name] = (df[part] / df[whole].replace(0, np.nan)) * 100
            elif mtype == "growth":
                curr = mdef["current"]
                prev = mdef["previous"]
                if mdef.get("growth_type") == "absolute":
                    df[name] = df[curr] - df[prev]
                else:
                    df[name] = ((df[curr] - df[prev]) / df[prev].replace(0, np.nan)) * 100
            elif mtype == "weighted_average":
                val = mdef["value_column"]
                wt = mdef["weight_column"]
                df[name] = df[val] * df[wt]  # Will be divided by sum of weights in aggregation
            elif mtype == "conditional":
                cond_col = mdef.get("cond_column", mdef.get("condition_column", ""))
                cond_op = mdef.get("cond_operator", mdef.get("condition_operator", "gt"))
                cond_val_str = mdef.get("cond_value", mdef.get("condition_value", "0"))
                try:
                    cond_val = float(cond_val_str)
                except (ValueError, TypeError):
                    cond_val = cond_val_str

                op_map = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<=", "eq": "==", "neq": "!="}
                op_str = op_map.get(str(cond_op), ">")

                if cond_col and cond_col in df.columns:
                    col_series = pd.to_numeric(df[cond_col], errors="coerce")
                    if op_str == ">": mask = col_series > cond_val
                    elif op_str == ">=": mask = col_series >= cond_val
                    elif op_str == "<": mask = col_series < cond_val
                    elif op_str == "<=": mask = col_series <= cond_val
                    elif op_str == "==": mask = col_series == cond_val
                    else: mask = col_series != cond_val

                    then_type = mdef.get("cond_then_type", "column")
                    else_type = mdef.get("cond_else_type", "value")
                    then_col = mdef.get("cond_then_col", "")
                    else_col = mdef.get("cond_else_col", "")
                    then_val_str = mdef.get("cond_then_val", "0")
                    else_val_str = mdef.get("cond_else_val", "0")

                    try:
                        then_val = float(then_val_str) if then_val_str else 0
                    except (ValueError, TypeError):
                        then_val = then_val_str
                    try:
                        else_val = float(else_val_str) if else_val_str else 0
                    except (ValueError, TypeError):
                        else_val = else_val_str

                    then_series = df[then_col] if then_type == "column" and then_col in df.columns else then_val
                    else_series = df[else_col] if else_type == "column" and else_col in df.columns else else_val

                    df[name] = np.where(mask, then_series, else_series)
            elif mtype == "index":
                base_col = mdef.get("base_column")
                base_val = mdef.get("base_value", 100)
                if base_col and base_col in df.columns:
                    base = df[base_col].mean()
                    if base != 0:
                        df[name] = (df[base_col] / base) * float(base_val)
                    else:
                        df[name] = np.nan
            elif mtype == "rank":
                rank_col = mdef.get("rank_column")
                rank_ord = mdef.get("rank_order", "desc")
                if rank_col and rank_col in df.columns:
                    df[name] = df[rank_col].rank(ascending=(rank_ord == "asc"), method="min")
            elif mtype == "cumulative":
                val_col = mdef.get("value_column")
                if val_col and val_col in df.columns:
                    df[name] = df[val_col].cumsum()
            elif mtype == "composite":
                col_a = mdef.get("column_a")
                col_b = mdef.get("column_b")
                op = mdef.get("operator", "+")
                if col_a and col_b and col_a in df.columns and col_b in df.columns:
                    if op == "+": df[name] = df[col_a] + df[col_b]
                    elif op == "-": df[name] = df[col_a] - df[col_b]
                    elif op == "*": df[name] = df[col_a] * df[col_b]
                    elif op == "/": df[name] = df[col_a] / df[col_b].replace(0, np.nan)
        except Exception:
            df[name] = np.nan

    return df


@app.post("/api/tabulate")
async def tabulate(config: TableConfig):
    """Generate a tabulated result based on the provided configuration."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    try:
        df = datasets[config.dataset_id]["df"].copy()
        original_row_count = len(df)

        # Apply custom metrics and bins
        df = apply_metrics_and_bins(df, config.dataset_id)

        # Detect and explode multi-choice columns used in rows/columns/values
        # Check user-set type overrides first, then auto-detect
        multi_choice_cols = []
        all_used_cols = list(set(config.rows + config.columns + list(config.filters.keys())))
        _type_overrides = column_type_overrides.get(config.dataset_id, {})
        for col_name in all_used_cols:
            override = _type_overrides.get(col_name)
            if override == "multi_choice":
                multi_choice_cols.append(col_name)
            elif override in ("text", "numeric", "date"):
                pass  # User explicitly set this type — respect it, not multi_choice
            elif col_name in df.columns and _is_multi_choice(df[col_name]):
                multi_choice_cols.append(col_name)

        # Also check VALUE columns that are NOT already covered by rows/columns
        # These are exploded so that count = individual responses (not just respondent count)
        # Only applies when the value column is multi_choice type (by override or auto-detection)
        for v in config.values:
            vc = v.get("field", "")
            if vc and vc not in multi_choice_cols and vc not in all_used_cols:
                override = _type_overrides.get(vc)
                if override == "multi_choice":
                    multi_choice_cols.append(vc)
                elif override is None and vc in df.columns and _is_multi_choice(df[vc]):
                    multi_choice_cols.append(vc)

        # Explode multi-choice columns: split comma-separated values into separate rows
        _nan_strs = {'nan', 'NaN', 'None', 'NaT', '', '<NA>', 'null'}
        for mc_col in multi_choice_cols:
            def _split_multi(x, _ns=_nan_strs):
                if pd.isna(x):
                    return [np.nan]
                s = str(x).strip()
                if s in _ns:
                    return [np.nan]
                if ',' in s:
                    parts = [p.strip() for p in s.split(',') if p.strip() and p.strip() not in _ns]
                    return parts if parts else [np.nan]
                return [s]
            df[mc_col] = df[mc_col].apply(_split_multi)
            df = df.explode(mc_col, ignore_index=True)
            # Drop rows where the exploded value is NaN/NaT (original nulls)
            mask = df[mc_col].apply(lambda x: pd.notna(x) and str(x).strip() not in _nan_strs)
            df = df[mask].reset_index(drop=True)

        # Apply date groupings (create derived grouping columns)
        for col, freq in (config.date_groupings or {}).items():
            if col in df.columns:
                derived_name = f"{col} ({freq})"
                freq_map = {"year": "YE", "quarter": "QE", "month": "ME", "week": "W", "day": "D"}
                try:
                    col_dt = pd.to_datetime(df[col], errors="coerce")
                    df[derived_name] = col_dt.dt.to_period(freq_map.get(freq, "ME")).astype(str)
                    # Replace original col reference with derived col in rows/columns
                    config.rows = [derived_name if r == col else r for r in config.rows]
                    config.columns = [derived_name if c == col else c for c in config.columns]
                except Exception:
                    pass

        # Apply filters
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        if df.empty:
            return {"headers": [], "rows": [], "row_count": 0, "col_count": 0}

        if not config.values:
            return {"headers": [], "rows": [], "row_count": 0, "col_count": 0}

        # Clean NaT/NaN from groupby/pivot fields to prevent index errors
        _bad_strs = {'nan', 'NaN', 'NaT', 'None', '<NA>'}
        for _gc in config.rows + config.columns:
            if _gc in df.columns:
                _nat_mask = df[_gc].apply(lambda v: pd.isna(v) or str(v).strip() in _bad_strs)
                if _nat_mask.any():
                    df.loc[_nat_mask, _gc] = "(blank)"

        # Simple case: rows only (no column pivoting)
        if config.rows and not config.columns:
            agg_dict = {}
            post_calcs = []  # For percentage calculations after groupby
            safe_fields = []

            for v in config.values:
                field = v["field"]
                safe_field = field
                if field in config.rows:
                    safe_field = f"__temp_{field}__"
                    df[safe_field] = df[field]
                safe_fields.append(safe_field)

                agg = v.get("agg", "sum")
                show_as = v.get("show_as", "normal")
                combo_show_as = v.get("combo_show_as", "normal")
                decimals = v.get("decimals", 2)
                vlabel = v.get("label", "")

                # Legacy compat: if agg is a show_as type (from old frontend), map it
                if agg in PERCENT_AGGS or agg in SPECIAL_AGGS:
                    show_as = agg
                    agg = "sum"

                # Auto-downgrade numeric agg to 'count' for text/multi-choice columns
                # (e.g. occupation codes "1","2","1,2","3,4,5" are categorical, not summable)
                if agg in NUMERIC_ONLY_AGGS and _col_is_text(df, safe_field):
                    agg = "count"

                if agg in AGG_MAP:
                    agg_dict[safe_field] = AGG_MAP[agg]
                else:
                    agg_dict[safe_field] = "sum"

                # Queue show_as post-calculation
                if show_as and show_as != "normal":
                    post_calcs.append({"field": safe_field, "agg": show_as, "label": vlabel, "decimals": decimals})
                # Queue combo post-calculation (value + % in parentheses)
                if combo_show_as and combo_show_as != "normal":
                    post_calcs.append({"field": safe_field, "agg": f"combo_{combo_show_as}", "label": vlabel, "decimals": decimals})

            result = df.groupby(config.rows, dropna=False).agg(agg_dict).reset_index()

            for sf in safe_fields:
                if sf != sf.replace("__temp_", "") and sf in df.columns:
                    df.drop(columns=[sf], inplace=True, errors="ignore")

            # Build column labels and fix post_calcs labels to match
            value_labels = []
            for v in config.values:
                label = v.get("label", f"{v.get('agg', 'sum').title()} of {v['field']}")
                value_labels.append(label)

            col_names = list(config.rows) + value_labels
            result.columns = col_names

            # Fix post_calcs: replace empty/missing labels with the actual column name
            label_by_field = {}
            for v, lbl in zip(config.values, value_labels):
                sf = v["field"]
                if sf in config.rows:
                    sf = f"__temp_{sf}__"
                label_by_field[sf] = lbl
            for pc in post_calcs:
                if not pc["label"] or pc["label"] not in result.columns:
                    pc["label"] = label_by_field.get(pc["field"], pc["label"])

            # Post-calculations (show_as transforms, combo display)
            for pc in post_calcs:
                label = pc["label"]
                agg = pc["agg"]
                dec = pc.get("decimals") if pc.get("decimals") is not None else 2
                if label not in result.columns:
                    continue

                is_combo = agg.startswith("combo_")
                actual_agg = agg.replace("combo_", "") if is_combo else agg

                if is_combo:
                    # Store original values for combo display
                    orig_values = result[label].copy()

                # Apply the show_as transformation
                def apply_show_as(series, show_as, rows, result_df, dec_places):
                    if show_as == "pct_grand":
                        total = series.sum()
                        if total != 0:
                            return (series / total * 100).round(dec_places)
                    elif show_as == "running_total":
                        return series.cumsum().round(dec_places)
                    elif show_as == "rank_asc":
                        return series.rank(ascending=True).astype(int)
                    elif show_as == "rank_desc":
                        return series.rank(ascending=False).astype(int)
                    elif show_as == "index":
                        base = series.mean()
                        if base and base != 0:
                            return (series / base * 100).round(dec_places)
                    elif show_as == "pct_parent_row" and len(rows) > 1:
                        parent_col = rows[0]
                        if parent_col in result_df.columns:
                            parent_sums = result_df.groupby(parent_col)[series.name].transform("sum")
                            return (series / parent_sums.replace(0, np.nan) * 100).round(dec_places)
                    elif show_as == "pct_parent_col" and len(rows) > 1:
                        parent_col = rows[0]
                        if parent_col in result_df.columns:
                            parent_sums = result_df.groupby(parent_col)[series.name].transform("sum")
                            return (series / parent_sums.replace(0, np.nan) * 100).round(dec_places)
                    elif show_as == "pct_row":
                        return series  # handled later in pivot path
                    elif show_as == "pct_col":
                        return series  # handled later in pivot path
                    elif show_as == "pct_point_change":
                        return series.diff().round(dec_places)
                    elif show_as == "change_vs_prev":
                        shifted = series.shift(1)
                        return ((series - shifted) / shifted.replace(0, np.nan) * 100).round(dec_places)
                    elif show_as == "z_score":
                        mean = series.mean()
                        std = series.std()
                        if std and std != 0:
                            return ((series - mean) / std).round(dec_places)
                    elif show_as == "percentile_rank":
                        return series.rank(pct=True).mul(100).round(dec_places)
                    elif show_as == "cagr":
                        # CAGR relative to first value over position
                        first_val = series.iloc[0] if len(series) > 0 else None
                        if first_val and first_val != 0:
                            periods = pd.Series(range(len(series)), index=series.index)
                            cagr_vals = ((series / first_val) ** (1 / periods.replace(0, 1)) - 1) * 100
                            cagr_vals.iloc[0] = 0  # First period has no growth
                            return cagr_vals.round(dec_places)
                    return series.round(dec_places) if dec_places is not None else series

                if is_combo:
                    # Compute the percentage values
                    pct_values = apply_show_as(result[label].copy(), actual_agg, config.rows, result, dec)
                    # Format as "value (pct%)" — handle NaN gracefully
                    missing_fill = config.missing_data if config.missing_data else ""
                    combo_col = []
                    for ov, pv in zip(orig_values, pct_values):
                        try:
                            ov_is_na = pd.isna(ov) if not isinstance(ov, str) else False
                            pv_is_na = pd.isna(pv) if not isinstance(pv, str) else False
                            if ov_is_na:
                                combo_col.append(missing_fill)
                            elif pv_is_na:
                                ov_str = f"{ov:,.{dec}f}" if isinstance(ov, (int, float)) else str(ov)
                                combo_col.append(ov_str)
                            else:
                                ov_str = f"{ov:,.{dec}f}" if isinstance(ov, (int, float)) else str(ov)
                                pv_str = f"{pv:.{dec}f}%" if isinstance(pv, (int, float)) else str(pv)
                                combo_col.append(f"{ov_str}\n({pv_str})")
                        except (ValueError, TypeError):
                            combo_col.append(missing_fill if pd.isna(ov) else str(ov))
                    result[label] = combo_col
                else:
                    result[label] = apply_show_as(result[label], actual_agg, config.rows, result, dec)

            # Apply decimal rounding for ALL value fields (regardless of show_as)
            # Skip columns that are already combo-formatted strings
            combo_labels = {pc["label"] for pc in post_calcs if pc["agg"].startswith("combo_")}
            for v, lbl in zip(config.values, value_labels):
                dec = v.get("decimals")
                if dec is not None and lbl in result.columns and lbl not in combo_labels:
                    try:
                        numeric_vals = pd.to_numeric(result[lbl], errors="coerce")
                        result[lbl] = numeric_vals.round(int(dec))
                    except Exception:
                        pass

            # Statistical display formatting (Mean±SD, SE, CI, stars, N, arrows, missing indicator)
            for v, lbl in zip(config.values, value_labels):
                if lbl not in result.columns:
                    continue
                dec = v.get("decimals") if v.get("decimals") is not None else 2
                missing_ind = v.get("missing_indicator", "")
                change_arrows = v.get("change_arrows", False)
                show_mean_sd = v.get("show_mean_sd", False)
                show_se = v.get("show_se", False)
                show_ci = v.get("show_ci", False)
                ci_level = v.get("ci_level", 0.95)
                show_stars = v.get("show_stars", False)
                show_n = v.get("show_n", False)

                col = result[lbl]
                numeric_col = pd.to_numeric(col, errors="coerce")

                # Missing data indicator
                if missing_ind:
                    result[lbl] = col.apply(lambda x: missing_ind if pd.isna(x) else x)

                # Change direction arrows
                if change_arrows:
                    def add_arrow(x):
                        if pd.isna(x) or not isinstance(x, (int, float)):
                            return x
                        if x > 0: return f"▲ {x}"
                        if x < 0: return f"▼ {x}"
                        return f"▶ {x}"
                    result[lbl] = result[lbl].apply(add_arrow)

                # Mean ± SD format (replace each group's values with "mean ± SD")
                if show_mean_sd and numeric_col.notna().any():
                    mean_val = numeric_col.mean()
                    sd_val = numeric_col.std()
                    result[lbl] = result[lbl].apply(
                        lambda x: f"{float(x):,.{dec}f} ± {sd_val:,.{dec}f}" if isinstance(x, (int, float)) and not pd.isna(x) else x
                    )

                # Standard error in parentheses
                if show_se and numeric_col.notna().any():
                    n = numeric_col.count()
                    se = numeric_col.std() / (n ** 0.5) if n > 0 else 0
                    result[lbl] = result[lbl].apply(
                        lambda x: f"{float(x):,.{dec}f} ({se:,.{dec}f})" if isinstance(x, (int, float)) and not pd.isna(x) else x
                    )

                # Confidence interval
                if show_ci and numeric_col.notna().any():
                    import scipy.stats as sp_stats
                    n = numeric_col.count()
                    mean = numeric_col.mean()
                    se = numeric_col.std() / (n ** 0.5) if n > 0 else 0
                    z_val = sp_stats.norm.ppf(1 - (1 - ci_level) / 2) if n > 30 else sp_stats.t.ppf(1 - (1 - ci_level) / 2, max(n-1, 1))
                    margin = z_val * se
                    lo, hi = mean - margin, mean + margin
                    result[lbl] = result[lbl].apply(
                        lambda x: f"{float(x):,.{dec}f} [{lo:,.{dec}f}, {hi:,.{dec}f}]" if isinstance(x, (int, float)) and not pd.isna(x) else x
                    )

                # Significance stars (based on z-score magnitude)
                if show_stars and numeric_col.notna().any():
                    thresholds = v.get("star_thresholds", [0.05, 0.01, 0.001])
                    mean = numeric_col.mean()
                    std = numeric_col.std()
                    def add_stars(x):
                        if not isinstance(x, (int, float)) or pd.isna(x):
                            return x
                        if std == 0 or pd.isna(std):
                            return f"{x:,.{dec}f}"
                        z = abs((x - mean) / std)
                        # Convert z to approximate p-value
                        try:
                            p = 2 * (1 - sp_stats.norm.cdf(z))
                        except:
                            return f"{x:,.{dec}f}"
                        stars = ""
                        if p < thresholds[-1]: stars = "***"
                        elif len(thresholds) > 1 and p < thresholds[-2]: stars = "**"
                        elif p < thresholds[0]: stars = "*"
                        return f"{x:,.{dec}f}{stars}" if not isinstance(x, str) else f"{x}{stars}"
                    result[lbl] = result[lbl].apply(add_stars)

                # Show N (sample size) - add as a column suffix in the label
                if show_n:
                    n = numeric_col.count()
                    new_lbl = f"{lbl} (N={n})"
                    result = result.rename(columns={lbl: new_lbl})
                    # Update value_labels reference
                    idx = value_labels.index(lbl)
                    value_labels[idx] = new_lbl

            # Custom sort orders (convert to categorical for ordering)
            if config.custom_sort_orders:
                for field, order_list in config.custom_sort_orders.items():
                    if field in result.columns and order_list:
                        cat_type = pd.CategoricalDtype(categories=order_list, ordered=True)
                        result[field] = result[field].astype(str).astype(cat_type)

            # Sorting
            if config.multi_sort:
                # Multi-key sort: apply sort keys in order, skip invalid fields
                valid_keys = [(sk["field"], sk["order"] == "asc") for sk in config.multi_sort if sk.get("field") and sk["field"] in result.columns]
                if valid_keys:
                    sort_cols = [k[0] for k in valid_keys]
                    sort_asc = [k[1] for k in valid_keys]
                    result = result.sort_values(sort_cols, ascending=sort_asc)
            elif config.custom_sort_orders and any(f in result.columns for f in config.custom_sort_orders):
                # Sort by first custom-ordered field
                first_custom = next(f for f in config.custom_sort_orders if f in result.columns)
                result = result.sort_values(first_custom)
            elif config.sort_by and config.sort_by in result.columns:
                result = result.sort_values(config.sort_by, ascending=(config.sort_order == "asc"))

            # Subtotals for hierarchical rows
            if config.subtotals and len(config.rows) >= 1:
                if len(config.rows) > 1:
                    # Multi-level rows: subtotal at each hierarchy level
                    subtotal_frames = [result]
                    for level in range(len(config.rows) - 1):
                        group_cols = config.rows[:level + 1]
                        sub = df.groupby(group_cols, dropna=False).agg(agg_dict).reset_index()
                        sub_labels = list(group_cols)
                        for r in config.rows[level + 1:]:
                            sub[r] = f"Subtotal"
                        sub_value_labels = value_labels.copy()
                        sub.columns = sub_labels + list(config.rows[level + 1:]) + sub_value_labels
                        sub = sub[col_names]
                        sub["__subtotal_level__"] = level + 1
                        subtotal_frames.append(sub)
                    result["__subtotal_level__"] = 0  # detail rows
                    result = pd.concat(subtotal_frames, ignore_index=True)
                    if config.subtotals_position == "top":
                        result["__sort_key__"] = result["__subtotal_level__"].apply(lambda x: 0 if x > 0 else 1)
                    else:
                        result["__sort_key__"] = result["__subtotal_level__"].apply(lambda x: 1 if x > 0 else 0)
                    result = result.sort_values(list(config.rows) + ["__sort_key__"]).reset_index(drop=True)
                    result.drop(columns=["__subtotal_level__", "__sort_key__"], inplace=True)
                else:
                    # Single row field: add subtotal per unique value of that row field
                    row_field = config.rows[0]
                    subtotal_frames = []
                    for group_val, group_df in result.groupby(row_field, dropna=False):
                        subtotal_frames.append(group_df)
                        sub_row = {}
                        sub_row[row_field] = f"{group_val} Subtotal"
                        for col in value_labels:
                            numeric_vals = pd.to_numeric(group_df[col], errors="coerce")
                            sub_row[col] = numeric_vals.sum()
                        subtotal_frames.append(pd.DataFrame([sub_row]))
                    if subtotal_frames:
                        result = pd.concat(subtotal_frames, ignore_index=True)

            # Grand total
            want_row_total = config.grand_total_rows if config.grand_total_rows is not None else config.grand_total
            if want_row_total:
                total_row = {}
                for i, r in enumerate(config.rows):
                    total_row[r] = "Grand Total" if i == 0 else ""
                for v, label in zip(config.values, value_labels):
                    field = v["field"]
                    agg = v.get("agg", "sum")
                    combo_sa = v.get("combo_show_as", "normal")
                    dec = v.get("decimals") if v.get("decimals") is not None else 2
                    if agg in ("sum", "running_total", "cumulative_sum"):
                        raw_val = df[field].sum()
                    elif agg == "count":
                        raw_val = len(df)
                    elif agg in ("average", "mean"):
                        raw_val = df[field].mean()
                    elif agg == "min":
                        raw_val = df[field].min()
                    elif agg == "max":
                        raw_val = df[field].max()
                    elif agg == "median":
                        raw_val = df[field].median()
                    elif agg == "pct_grand":
                        raw_val = 100.0
                    else:
                        raw_val = df[field].sum()

                    # Apply combo formatting to grand total (always 100% for pct_grand)
                    if combo_sa and combo_sa != "normal":
                        try:
                            ov_str = f"{raw_val:,.{dec}f}" if isinstance(raw_val, (int, float)) and not pd.isna(raw_val) else str(raw_val)
                            total_row[label] = f"{ov_str}\n(100.00%)"
                        except (ValueError, TypeError):
                            total_row[label] = raw_val
                    else:
                        total_row[label] = raw_val
                # Add multi-response note if applicable
                if multi_choice_cols:
                    total_row["__note__"] = f"* Multiple responses: {', '.join(multi_choice_cols)}. Total responses may exceed {original_row_count} respondents."
                result = pd.concat([result, pd.DataFrame([total_row])], ignore_index=True)

            # Blank suppression
            if config.blank_suppress:
                value_cols = [v.get("label", f"{v.get('agg','sum').title()} of {v['field']}") for v in config.values]
                numeric_mask = result[value_cols].apply(pd.to_numeric, errors="coerce").fillna(0)
                keep = (numeric_mask != 0).any(axis=1)
                grand_total_mask = result[config.rows[0]].astype(str) == "Grand Total" if config.rows else pd.Series(True, index=result.index)
                result = result[keep | grand_total_mask].reset_index(drop=True)

            # Remove internal __note__ column, preserve it for response
            note = None
            if "__note__" in result.columns:
                notes = result["__note__"].dropna().tolist()
                note = notes[0] if notes else None
                result = result.drop(columns=["__note__"])

            headers = list(result.columns)
            rows = sanitize_for_json(result.fillna(config.missing_data).values.tolist())
            resp = {"headers": headers, "rows": rows, "row_count": len(rows), "col_count": len(headers)}
            if multi_choice_cols:
                resp["multi_response_note"] = note or f"* Multiple responses: {', '.join(multi_choice_cols)}. Total responses ({len(df)}) may exceed {original_row_count} respondents."
                resp["original_respondents"] = original_row_count
                resp["total_responses"] = len(df)
            return resp

        # Pivot table case
        elif config.rows and config.columns:
            val_field = config.values[0]["field"]
            _raw_agg = config.values[0].get("agg", "sum")
            # Auto-downgrade numeric agg to 'count' for text/multi-choice value columns
            if _raw_agg in NUMERIC_ONLY_AGGS and _col_is_text(df, val_field):
                _raw_agg = "count"
            agg_func = AGG_MAP.get(_raw_agg, "sum")

            # Pandas pivot_table fails if val_field is in rows or columns
            temp_val_field = val_field
            if val_field in config.rows or val_field in config.columns:
                temp_val_field = f"__temp_{val_field}__"
                df[temp_val_field] = df[val_field]

            # Handle same field in both rows and columns — create temp copy for columns
            temp_cols = list(config.columns)
            temp_col_renames = {}
            for i, col in enumerate(temp_cols):
                if col in config.rows:
                    temp_name = f"__col_{col}__"
                    df[temp_name] = df[col]
                    temp_cols[i] = temp_name
                    temp_col_renames[temp_name] = col

            want_row_total_pivot = config.grand_total_rows if config.grand_total_rows is not None else config.grand_total
            want_col_total_pivot = config.grand_total_columns if config.grand_total_columns is not None else config.grand_total
            need_margins = want_row_total_pivot or want_col_total_pivot

            # Clean NaT/NaN from pivot index and column fields to prevent margins errors
            for _pc in config.rows + temp_cols:
                if _pc in df.columns:
                    _nat_mask = df[_pc].apply(lambda v: pd.isna(v) or str(v).strip() in ('nan', 'NaN', 'NaT', 'None', '<NA>'))
                    if _nat_mask.any():
                        df.loc[_nat_mask, _pc] = "(blank)"

            pivot = pd.pivot_table(
                df,
                values=temp_val_field,
                index=config.rows,
                columns=temp_cols,
                aggfunc=agg_func,
                fill_value=0 if config.missing_data == "0" else None,
                margins=need_margins,
                margins_name="Grand Total",
                dropna=False,
            )

            # Selectively remove row or column grand totals
            if need_margins:
                if not want_row_total_pivot:
                    # Remove the Grand Total row (last row added by margins)
                    if "Grand Total" in pivot.index.get_level_values(-1).astype(str).tolist():
                        pivot = pivot.drop("Grand Total", axis=0, errors="ignore")
                if not want_col_total_pivot:
                    # Remove the Grand Total column
                    if isinstance(pivot.columns, pd.MultiIndex):
                        cols_to_drop = [c for c in pivot.columns if "Grand Total" in [str(x) for x in c]]
                        if cols_to_drop:
                            pivot = pivot.drop(columns=cols_to_drop, errors="ignore")
                    else:
                        if "Grand Total" in pivot.columns.astype(str).tolist():
                            pivot = pivot.drop(columns=["Grand Total"], errors="ignore")

            if temp_val_field != val_field:
                df.drop(columns=[temp_val_field], inplace=True, errors="ignore")
            for temp_name in temp_col_renames:
                df.drop(columns=[temp_name], inplace=True, errors="ignore")

            column_groups = None
            if isinstance(pivot.columns, pd.MultiIndex):
                # Insert column-group subtotals before flattening
                if config.subtotals:
                    from collections import OrderedDict
                    top_level_values = list(OrderedDict.fromkeys(
                        str(col[0]) for col in pivot.columns if str(col[0]) != "Grand Total"
                    ))
                    if len(top_level_values) > 1:
                        new_cols_order = []
                        for top_val in top_level_values:
                            group_cols = [c for c in pivot.columns if str(c[0]) == top_val]
                            new_cols_order.extend(group_cols)
                            if len(group_cols) > 1:
                                subtotal_col_name = (top_val, "Subtotal")
                                pivot[subtotal_col_name] = pivot[group_cols].sum(axis=1)
                                new_cols_order.append(subtotal_col_name)
                        # Add Grand Total columns at the end if they exist
                        gt_cols = [c for c in pivot.columns if str(c[0]) == "Grand Total"]
                        new_cols_order.extend(gt_cols)
                        pivot = pivot[new_cols_order]

                # Build column groups for multi-level header merging
                raw_levels = list(pivot.columns)
                n_row_cols = len(config.rows)
                top_labels = [col[0] if len(col) > 0 else "" for col in raw_levels]
                bot_labels = [col[1] if len(col) > 1 else str(col[0]) for col in raw_levels]
                # Build groups: consecutive same top_labels get merged
                groups = []
                i = 0
                while i < len(top_labels):
                    label = str(top_labels[i])
                    span = 1
                    while i + span < len(top_labels) and str(top_labels[i + span]) == label:
                        span += 1
                    groups.append({"label": label, "colspan": span, "colstart": i})
                    i += span
                column_groups = {
                    "top": groups,
                    "bottom": [str(b) for b in bot_labels],
                    "has_multi_level": len(set(str(t) for t in top_labels)) > 1,
                }
                pivot.columns = [" | ".join(str(c) for c in col if str(c) != "").strip() for col in pivot.columns]

            pivot = pivot.reset_index()

            # Subtotals for pivot table with hierarchical rows
            if config.subtotals and len(config.rows) > 1:
                numeric_cols = pivot.select_dtypes(include=[np.number]).columns.tolist()
                subtotal_frames = []
                for level in range(len(config.rows) - 1):
                    group_cols = config.rows[:level + 1]
                    sub = pivot.groupby(group_cols, dropna=False)[numeric_cols].sum().reset_index()
                    for r in config.rows[level + 1:]:
                        sub[r] = "Subtotal"
                    for c in pivot.columns:
                        if c not in sub.columns:
                            sub[c] = ""
                    sub = sub[pivot.columns]
                    sub["__subtotal_level__"] = level + 1
                    subtotal_frames.append(sub)
                pivot["__subtotal_level__"] = 0
                pivot = pd.concat([pivot] + subtotal_frames, ignore_index=True)
                if config.subtotals_position == "top":
                    pivot["__sort_key__"] = pivot["__subtotal_level__"].apply(lambda x: 0 if x > 0 else 1)
                else:
                    pivot["__sort_key__"] = pivot["__subtotal_level__"].apply(lambda x: 1 if x > 0 else 0)
                pivot = pivot.sort_values(list(config.rows) + ["__sort_key__"]).reset_index(drop=True)
                pivot.drop(columns=["__subtotal_level__", "__sort_key__"], inplace=True)

            # Percentage of row/column total for pivot
            v0 = config.values[0]
            show_as = v0.get("show_as", "normal")
            combo_show_as = v0.get("combo_show_as", "normal")
            dec = v0.get("decimals", 2)
            # Legacy compat: old frontend sends pct_row/pct_col as agg
            if v0.get("agg", "sum") in PERCENT_AGGS:
                show_as = v0["agg"]

            def apply_pivot_show_as(pivot_df, sa, decimal_places):
                numeric_cols = pivot_df.select_dtypes(include=[np.number]).columns
                # Exclude Grand Total and Subtotal columns from percentage calculations
                data_cols = [c for c in numeric_cols if not str(c).startswith("Grand Total") and "| Subtotal" not in str(c)]
                has_margin_col = any(str(c).startswith("Grand Total") for c in numeric_cols)

                def _is_gt_col(col_name):
                    return str(col_name).startswith("Grand Total")

                def _is_subtotal_col(col_name):
                    return "| Subtotal" in str(col_name)

                if sa == "pct_row":
                    row_sums = pivot_df[data_cols].sum(axis=1) if data_cols else pivot_df[numeric_cols].sum(axis=1)
                    for c in numeric_cols:
                        pivot_df[c] = (pivot_df[c] / row_sums.replace(0, np.nan) * 100).round(decimal_places)
                elif sa == "pct_col":
                    for c in numeric_cols:
                        if _is_gt_col(c) or _is_subtotal_col(c):
                            continue
                        col_data = pivot_df[c]
                        # Use the Grand Total row value as the denominator if margins exist
                        if config.grand_total and len(pivot_df) > 0:
                            gt_mask = pivot_df.index.get_level_values(0).astype(str) == "Grand Total" if isinstance(pivot_df.index, pd.MultiIndex) else pivot_df.iloc[:, 0].astype(str) == "Grand Total"
                            if gt_mask.any():
                                col_sum = pivot_df.loc[gt_mask, c].iloc[0]
                            else:
                                col_sum = col_data.sum()
                        else:
                            col_sum = col_data.sum()
                        if col_sum != 0:
                            pivot_df[c] = (pivot_df[c] / col_sum * 100).round(decimal_places)
                    # Grand Total column should show 100% for each row
                    gt_col = next((c for c in pivot_df.columns if _is_gt_col(c)), None)
                    if has_margin_col and gt_col:
                        pivot_df[gt_col] = 100.0
                elif sa == "pct_grand":
                    # Use only data columns to calculate the grand total (exclude margin column)
                    grand = pivot_df[data_cols].values.sum() if data_cols else pivot_df[numeric_cols].values.sum()
                    # If margins exist, the actual grand is half (margins double it)
                    if has_margin_col and config.grand_total:
                        grand = grand  # data_cols already excludes Grand Total column
                    if grand != 0:
                        for c in numeric_cols:
                            pivot_df[c] = (pivot_df[c] / grand * 100).round(decimal_places)
                return pivot_df

            if combo_show_as and combo_show_as != "normal":
                # Store original values, compute %, then combine
                orig_pivot = pivot.copy()
                apply_pivot_show_as(pivot, combo_show_as, dec)
                numeric_cols = orig_pivot.select_dtypes(include=[np.number]).columns
                for c in numeric_cols:
                    combined = []
                    for ov, pv in zip(orig_pivot[c], pivot[c]):
                        try:
                            ov_s = f"{ov:,.{dec}f}" if isinstance(ov, (int, float)) and not pd.isna(ov) else str(ov)
                            pv_s = f"{pv:.{dec}f}%" if isinstance(pv, (int, float)) and not pd.isna(pv) else str(pv)
                            combined.append(f"{ov_s}\n({pv_s})")
                        except (ValueError, TypeError):
                            combined.append(str(ov))
                    pivot[c] = combined
            elif show_as and show_as != "normal":
                apply_pivot_show_as(pivot, show_as, dec)

            # Apply decimal rounding to all numeric columns
            if dec is not None:
                for c in pivot.select_dtypes(include=[np.number]).columns:
                    pivot[c] = pivot[c].round(int(dec))

            headers = [str(c) for c in pivot.columns]
            rows = sanitize_for_json(pivot.fillna(config.missing_data).values.tolist())
            result_obj = {"headers": headers, "rows": rows, "row_count": len(rows), "col_count": len(headers)}
            if column_groups:
                result_obj["column_groups"] = column_groups
            if multi_choice_cols:
                result_obj["multi_response_note"] = f"* Multiple responses: {', '.join(multi_choice_cols)}. Total responses ({len(df)}) may exceed {original_row_count} respondents."
                result_obj["original_respondents"] = original_row_count
                result_obj["total_responses"] = len(df)
            return result_obj

        # Only values, no grouping
        else:
            result = {}
            for v in config.values:
                field = v["field"]
                agg = v.get("agg", "sum")
                label = v.get("label", f"{agg.title()} of {field}")
                if agg == "sum":
                    result[label] = df[field].sum()
                elif agg == "count":
                    result[label] = len(df)
                elif agg in ("average", "mean"):
                    result[label] = df[field].mean()
                elif agg == "min":
                    result[label] = df[field].min()
                elif agg == "max":
                    result[label] = df[field].max()
                elif agg == "median":
                    result[label] = df[field].median()
                elif agg == "std":
                    result[label] = df[field].std()
                elif agg == "var":
                    result[label] = df[field].var()
                else:
                    result[label] = df[field].sum()

            headers = list(result.keys())
            rows = [list(result.values())]
            return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": 1, "col_count": len(headers)}

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Tabulation error: {str(e)}")


# ═══════════════════════════════════════════════════
# Module G: Metric Builder
# ═══════════════════════════════════════════════════

class MetricDef(BaseModel):
    dataset_id: str
    name: str
    metric_type: str  # formula, ratio, percentage, growth, weighted_average, conditional, rank, cumulative
    column_a: Optional[str] = None
    column_b: Optional[str] = None
    operator: Optional[str] = None  # +, -, *, /
    numerator: Optional[str] = None
    denominator: Optional[str] = None
    part: Optional[str] = None
    whole: Optional[str] = None
    current: Optional[str] = None
    previous: Optional[str] = None
    growth_type: str = "percentage"  # percentage or absolute
    value_column: Optional[str] = None
    weight_column: Optional[str] = None
    condition_column: Optional[str] = None
    condition_operator: Optional[str] = None
    condition_value: Optional[str] = None
    then_column: Optional[str] = None
    else_column: Optional[str] = None
    # New conditional/IF fields
    cond_column: Optional[str] = None
    cond_operator: Optional[str] = None
    cond_value: Optional[str] = None
    cond_then_type: Optional[str] = None
    cond_then_col: Optional[str] = None
    cond_then_val: Optional[str] = None
    cond_else_type: Optional[str] = None
    cond_else_col: Optional[str] = None
    cond_else_val: Optional[str] = None
    format_type: str = "number"  # number, percentage, currency
    decimal_places: int = 2


@app.post("/api/metrics/create")
async def create_metric(metric: MetricDef):
    """Create a custom metric and return preview values."""
    if metric.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[metric.dataset_id]["df"].copy()
    mdef = metric.model_dump()

    # Compute metric for preview
    try:
        df = apply_metrics_and_bins(df, metric.dataset_id)
        # Temporarily add this metric
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
        # Roll back
        custom_metrics[metric.dataset_id] = [m for m in custom_metrics.get(metric.dataset_id, []) if m["name"] != metric.name]
        raise HTTPException(400, f"Metric error: {str(e)}")


@app.delete("/api/metrics/{dataset_id}/{metric_name}")
async def delete_metric(dataset_id: str, metric_name: str):
    """Delete a custom metric."""
    if dataset_id not in custom_metrics:
        raise HTTPException(404, "Dataset not found")
    custom_metrics[dataset_id] = [m for m in custom_metrics[dataset_id] if m["name"] != metric_name]
    return {"message": f"Metric '{metric_name}' deleted"}


@app.get("/api/metrics/{dataset_id}")
async def list_metrics(dataset_id: str):
    """List all custom metrics for a dataset."""
    return {"metrics": custom_metrics.get(dataset_id, [])}


# ═══════════════════════════════════════════════════
# Module H: Bin Creator
# ═══════════════════════════════════════════════════

class BinDef(BaseModel):
    dataset_id: str
    name: str
    source_column: str
    bin_type: str  # numeric, date, date_range, text, regex, group, relative_date
    ranges: list[dict] = []
    frequency: Optional[str] = None
    mapping: Optional[dict] = None
    # New fields
    lower_inclusive: bool = True
    upper_inclusive: bool = False
    remainder_label: Optional[str] = None
    case_normalize: Optional[str] = None  # none, lower, upper, title
    quantile_type: Optional[str] = None
    num_bins: Optional[int] = None
    fiscal_start_month: Optional[int] = None
    regex_patterns: list[dict] = []
    group_map: Optional[dict] = None
    date_ranges: list[dict] = []  # [{label, start, end}]


@app.post("/api/bins/create")
async def create_bin(bindef: BinDef):
    """Create a bin/recode definition."""
    if bindef.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    bdef = bindef.model_dump()
    bins_list = custom_bins.get(bindef.dataset_id, [])
    # Replace if exists
    bins_list = [b for b in bins_list if b["name"] != bindef.name]
    bins_list.append(bdef)
    custom_bins[bindef.dataset_id] = bins_list

    # Preview
    df = datasets[bindef.dataset_id]["df"].copy()
    df = apply_metrics_and_bins(df, bindef.dataset_id)

    if bindef.name in df.columns:
        value_counts = df[bindef.name].value_counts().to_dict()
        preview = {str(k): int(v) for k, v in list(value_counts.items())[:10]}
    else:
        preview = {}

    return {"name": bindef.name, "preview": preview, "type": "text"}


@app.delete("/api/bins/{dataset_id}/{bin_name}")
async def delete_bin(dataset_id: str, bin_name: str):
    if dataset_id not in custom_bins:
        raise HTTPException(404, "Dataset not found")
    custom_bins[dataset_id] = [b for b in custom_bins[dataset_id] if b["name"] != bin_name]
    return {"message": f"Bin '{bin_name}' deleted"}


@app.get("/api/bins/{dataset_id}")
async def list_bins(dataset_id: str):
    return {"bins": custom_bins.get(dataset_id, [])}


@app.get("/api/bin/auto_detect")
async def auto_detect_codings(dataset_id: str, column: str):
    """Auto-detect common codings in a column (e.g., 1/2 → Male/Female)."""
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[dataset_id]["df"]
    if column not in df.columns:
        raise HTTPException(400, f"Column '{column}' not found")

    COMMON_CODINGS = {
        # Gender
        "1": "Male", "2": "Female", "3": "Other",
        "m": "Male", "f": "Female", "male": "Male", "female": "Female",
        "M": "Male", "F": "Female",
        # Yes/No
        "0": "No", "y": "Yes", "n": "No", "yes": "Yes", "no": "No",
        "true": "True", "false": "False", "t": "True",
        # Grade scales
        "a": "Excellent", "b": "Good", "c": "Average", "d": "Below Average",
        # Common numeric codes
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


# ═══════════════════════════════════════════════════
# Column Values (for filters)
# ═══════════════════════════════════════════════════

@app.get("/api/dataset/{dataset_id}/column/{column_name}/values")
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
        # For multi-choice columns, split comma-separated values into individual choices
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


@app.get("/api/dataset/{dataset_id}/column-values")
async def get_column_values_by_query(dataset_id: str, column: str = Query(...)):
    """Same as get_column_values but accepts the column name as a query param.
    This avoids URL-routing issues when column names contain forward slashes."""
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


# ═══════════════════════════════════════════════════
# Data Quality / Validation
# ═══════════════════════════════════════════════════

@app.get("/api/dataset/{dataset_id}/quality")
async def data_quality(dataset_id: str):
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[dataset_id]["df"]
    report = []
    for col in df.columns:
        nulls = int(df[col].isna().sum())
        total = len(df)
        null_pct = round(nulls / total * 100, 1) if total > 0 else 0
        unique = int(df[col].nunique())
        duplicates = int(total - unique) if unique < total else 0

        status = "green"
        issues = []
        outliers = 0
        type_mismatch = 0

        if null_pct > 10:
            status = "red"
            issues.append(f"{null_pct}% missing values")
        elif null_pct > 0:
            status = "yellow"
            issues.append(f"{null_pct}% missing values")

        if unique > 500:
            issues.append(f"High cardinality ({unique} unique)")
            if status == "green": status = "yellow"

        # Outlier detection (3σ) for numeric columns
        dtype = str(df[col].dtype)
        if "int" in dtype or "float" in dtype:
            col_clean = df[col].dropna()
            if len(col_clean) > 10:
                mean = col_clean.mean()
                std = col_clean.std()
                if std > 0:
                    outliers = int(((col_clean - mean).abs() > 3 * std).sum())
                    if outliers > 0:
                        issues.append(f"{outliers} statistical outliers (>3σ)")
                        if status == "green": status = "yellow"

        # Type mismatch detection for text columns that look numeric/date
        if "object" in dtype:
            sample = df[col].dropna().head(100)
            numeric_parseable = 0
            for v in sample:
                try:
                    float(str(v).replace(",", ""))
                    numeric_parseable += 1
                except (ValueError, TypeError):
                    pass
            if numeric_parseable > len(sample) * 0.8 and len(sample) > 0:
                type_mismatch = int(numeric_parseable)
                issues.append(f"Stored as text but ~{numeric_parseable} values look numeric")
                if status == "green": status = "yellow"

        report.append({
            "column": col, "status": status, "nulls": nulls, "null_pct": null_pct,
            "unique": unique, "duplicates": duplicates, "issues": issues,
            "outliers": outliers, "type_mismatch": type_mismatch,
        })

    dup_rows = int(df.duplicated().sum())

    # Consistency checks: flag any column that appears in two different types across time
    for col_data in report:
        col = col_data["column"]
        if col_data["type_mismatch"] > 0:
            col_data["issues"].append("Consistency: mixed types detected in column")

    # Add multi-choice detection to quality report
    for col_data in report:
        col = col_data["column"]
        if col in df.columns and _is_multi_choice(df[col]):
            col_data["is_multi_choice"] = True
            col_data["issues"].append("Multi-choice column (comma-separated values)")

    return {"columns": report, "duplicate_rows": dup_rows, "total_rows": len(df)}


# ── Data Type Validation ──

@app.get("/api/dataset/{dataset_id}/column/{column_name}/type_info")
async def column_type_info(dataset_id: str, column_name: str):
    """Analyze a column's data types and return mixed-type info for validation."""
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[dataset_id]["df"]
    if column_name not in df.columns:
        raise HTTPException(400, f"Column '{column_name}' not found")

    col = df[column_name].dropna()
    total = len(col)
    if total == 0:
        return {"column": column_name, "detected_type": "empty", "mixed": False, "type_counts": {}}

    type_counts = {"numeric": 0, "date": 0, "text": 0}
    sample = col.head(500)
    for val in sample:
        sval = str(val).strip()
        try:
            float(sval.replace(",", ""))
            type_counts["numeric"] += 1
            continue
        except (ValueError, TypeError):
            pass
        try:
            pd.to_datetime(sval)
            type_counts["date"] += 1
            continue
        except (ValueError, TypeError):
            pass
        type_counts["text"] += 1

    # Scale counts to full column
    scale = total / len(sample) if len(sample) > 0 else 1
    type_counts = {k: int(v * scale) for k, v in type_counts.items()}

    dominant = max(type_counts, key=type_counts.get)
    mixed = sum(1 for v in type_counts.values() if v > total * 0.05) > 1

    # Get sample of non-conforming values
    non_conforming = []
    if mixed:
        for val in col.head(200):
            sval = str(val).strip()
            if dominant == "numeric":
                try:
                    float(sval.replace(",", ""))
                except (ValueError, TypeError):
                    if len(non_conforming) < 10:
                        non_conforming.append(sval)
            elif dominant == "date":
                try:
                    pd.to_datetime(sval)
                except (ValueError, TypeError):
                    if len(non_conforming) < 10:
                        non_conforming.append(sval)

    return {
        "column": column_name,
        "detected_type": dominant,
        "mixed": mixed,
        "type_counts": type_counts,
        "total": total,
        "non_conforming_samples": non_conforming,
        "current_dtype": str(df[column_name].dtype),
    }


class CleanColumnRequest(BaseModel):
    dataset_id: str
    column: str
    target_type: str  # "numeric", "date", "text"
    action: str = "coerce"  # "coerce" (convert, set invalid to NaN), "exclude" (remove non-conforming rows), "keep" (no change)


@app.post("/api/dataset/clean_column")
async def clean_column(req: CleanColumnRequest):
    """Clean a column by converting to the specified type."""
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[req.dataset_id]["df"]
    if req.column not in df.columns:
        raise HTTPException(400, f"Column '{req.column}' not found")

    original_nulls = int(df[req.column].isna().sum())

    if req.action == "keep":
        return {"message": "No changes applied", "rows_affected": 0}

    if req.target_type == "numeric":
        if req.action == "coerce":
            df[req.column] = pd.to_numeric(df[req.column], errors="coerce")
        elif req.action == "exclude":
            mask = pd.to_numeric(df[req.column], errors="coerce").notna() | df[req.column].isna()
            excluded = int((~mask).sum())
            datasets[req.dataset_id]["df"] = df[mask].reset_index(drop=True)
            add_audit_log(req.dataset_id, "clean_column", f"Excluded {excluded} non-numeric rows from '{req.column}'")
            return {"message": f"Excluded {excluded} non-numeric rows", "rows_affected": excluded}
    elif req.target_type == "date":
        if req.action == "coerce":
            df[req.column] = pd.to_datetime(df[req.column], errors="coerce")
        elif req.action == "exclude":
            mask = pd.to_datetime(df[req.column], errors="coerce").notna() | df[req.column].isna()
            excluded = int((~mask).sum())
            datasets[req.dataset_id]["df"] = df[mask].reset_index(drop=True)
            add_audit_log(req.dataset_id, "clean_column", f"Excluded {excluded} non-date rows from '{req.column}'")
            return {"message": f"Excluded {excluded} non-date rows", "rows_affected": excluded}
    elif req.target_type == "text":
        df[req.column] = df[req.column].astype(str)

    new_nulls = int(df[req.column].isna().sum())
    coerced = new_nulls - original_nulls
    add_audit_log(req.dataset_id, "clean_column", f"Converted '{req.column}' to {req.target_type}, {coerced} values coerced to NaN")

    # Re-detect columns
    columns = _detect_columns(datasets[req.dataset_id]["df"])
    return {
        "message": f"Converted '{req.column}' to {req.target_type}. {coerced} invalid values set to NaN.",
        "rows_affected": coerced,
        "columns": columns,
    }


class CleanBulkRequest(BaseModel):
    dataset_id: str
    actions: list[dict]  # [{column, action, ...}]


@app.post("/api/dataset/clean_bulk")
async def clean_bulk(req: CleanBulkRequest):
    """Apply multiple cleaning actions: remove_duplicates, fill_nulls, remove_outliers."""
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[req.dataset_id]["df"]
    results = []

    for action in req.actions:
        act = action.get("action", "")
        col = action.get("column", "")

        if act == "remove_duplicates":
            before = len(df)
            df = df.drop_duplicates().reset_index(drop=True)
            removed = before - len(df)
            results.append(f"Removed {removed} duplicate rows")
            add_audit_log(req.dataset_id, "clean_bulk", f"Removed {removed} duplicate rows")

        elif act == "fill_nulls" and col in df.columns:
            method = action.get("method", "median")
            if method == "median":
                fill_val = pd.to_numeric(df[col], errors="coerce").median()
            elif method == "mean":
                fill_val = pd.to_numeric(df[col], errors="coerce").mean()
            elif method == "mode":
                modes = df[col].mode()
                fill_val = modes.iloc[0] if len(modes) > 0 else ""
            elif method == "zero":
                fill_val = 0
            elif method == "empty":
                fill_val = ""
            else:
                fill_val = action.get("value", "")
            filled = int(df[col].isna().sum())
            df[col] = df[col].fillna(fill_val)
            results.append(f"Filled {filled} nulls in '{col}' with {method}")
            add_audit_log(req.dataset_id, "clean_bulk", f"Filled {filled} nulls in '{col}' with {method}")

        elif act == "remove_outliers" and col in df.columns:
            num_col = pd.to_numeric(df[col], errors="coerce")
            mean = num_col.mean()
            std = num_col.std()
            if std and std > 0:
                mask = (num_col - mean).abs() <= 3 * std
                removed = int((~mask & num_col.notna()).sum())
                df = df[mask | num_col.isna()].reset_index(drop=True)
                results.append(f"Removed {removed} outliers from '{col}'")
                add_audit_log(req.dataset_id, "clean_bulk", f"Removed {removed} outliers from '{col}'")

        elif act == "trim_whitespace":
            cols = [col] if col else [c for c in df.columns if df[c].dtype == object]
            trimmed = 0
            for c in cols:
                if c in df.columns and df[c].dtype == object:
                    before = df[c].copy()
                    df[c] = df[c].where(df[c].isna(), df[c].astype(str).str.strip())
                    trimmed += int((before.fillna("__NA__") != df[c].fillna("__NA__")).sum())
            results.append(f"Trimmed whitespace in {len(cols)} column(s), {trimmed} cells changed")
            add_audit_log(req.dataset_id, "clean_bulk", f"Trimmed whitespace: {trimmed} cells")

        elif act == "text_case" and col in df.columns:
            case_type = action.get("case_type", "lower")
            if df[col].dtype == object:
                before = df[col].copy()
                if case_type == "upper":
                    df[col] = df[col].where(df[col].isna(), df[col].astype(str).str.upper())
                elif case_type == "lower":
                    df[col] = df[col].where(df[col].isna(), df[col].astype(str).str.lower())
                elif case_type == "proper":
                    df[col] = df[col].where(df[col].isna(), df[col].astype(str).str.title())
                changed = int((before.fillna("__NA__") != df[col].fillna("__NA__")).sum())
                results.append(f"Converted '{col}' to {case_type} case, {changed} cells changed")
                add_audit_log(req.dataset_id, "clean_bulk", f"Text case {case_type} on '{col}': {changed} cells")

    datasets[req.dataset_id]["df"] = df
    columns = _detect_columns(df)
    return {"messages": results, "row_count": len(df), "columns": columns}


@app.get("/api/quality/{dataset_id}/drilldown")
async def quality_drilldown(dataset_id: str, column: str, issue_type: str = "nulls"):
    """Get detail rows for a specific quality flag."""
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[dataset_id]["df"]
    if column not in df.columns:
        raise HTTPException(400, f"Column '{column}' not found")

    if issue_type == "nulls":
        mask = df[column].isna()
    elif issue_type == "outliers":
        col_clean = pd.to_numeric(df[column], errors="coerce")
        mean = col_clean.mean()
        std = col_clean.std()
        mask = (col_clean - mean).abs() > 3 * std if std > 0 else pd.Series(False, index=df.index)
    elif issue_type == "duplicates":
        mask = df.duplicated(keep=False)
    else:
        mask = df[column].notna()

    detail_rows = df[mask].head(50)
    return {
        "column": column,
        "issue_type": issue_type,
        "row_count": int(mask.sum()),
        "headers": list(detail_rows.columns),
        "rows": sanitize_for_json(detail_rows.fillna("").values.tolist()[:50]),
    }


@app.get("/api/audit/{dataset_id}")
async def get_audit_log(dataset_id: str):
    """Get audit trail for a dataset."""
    return {"logs": audit_logs.get(dataset_id, [])}


class AuditEventBody(BaseModel):
    dataset_id: str
    action: str
    details: str = ""

@app.post("/api/audit/log")
async def log_audit_event(body: AuditEventBody):
    """Log a client-side audit event (e.g. column rename, title change)."""
    add_audit_log(body.dataset_id, body.action, body.details)
    return {"ok": True}


# ═══════════════════════════════════════════════════
# Module G: Global Metric Library
# ═══════════════════════════════════════════════════

class LibraryMetric(BaseModel):
    name: str
    metric_type: str
    definition: dict
    tags: list = []
    category: str = "General"
    description: str = ""


@app.get("/api/library/metrics")
async def list_library_metrics(search: str = "", tag: str = "", category: str = ""):
    """List all metrics in the global library, with optional search/filter."""
    all_metrics = []
    for f in LIBRARY_DIR.glob("*.json"):
        try:
            all_metrics.append(json.loads(f.read_text()))
        except Exception:
            pass
    # Collect all categories and tags before filtering
    all_categories = sorted(set(m.get("category", "General") for m in all_metrics))
    all_tags_list = sorted(set(t for m in all_metrics for t in m.get("tags", [])))
    # Apply filters
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


@app.post("/api/library/metrics")
async def save_library_metric(metric: LibraryMetric):
    """Save a metric to the global library."""
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


@app.delete("/api/library/metrics/{metric_id}")
async def delete_library_metric(metric_id: str):
    """Remove a metric from the global library."""
    filepath = LIBRARY_DIR / f"{metric_id}.json"
    if not filepath.exists():
        raise HTTPException(404, "Metric not found in library")
    filepath.unlink()
    return {"message": "Deleted from library"}


@app.post("/api/library/metrics/{metric_id}/import")
async def import_library_metric(metric_id: str, dataset_id: str = Query(...)):
    """Import a library metric into the current project dataset."""
    filepath = LIBRARY_DIR / f"{metric_id}.json"
    if not filepath.exists():
        raise HTTPException(404, "Metric not found in library")
    data = json.loads(filepath.read_text())
    # Increment usage count
    data["usage_count"] = data.get("usage_count", 0) + 1
    filepath.write_text(json.dumps(data, indent=2))
    # Import into dataset metrics
    if dataset_id not in custom_metrics:
        custom_metrics[dataset_id] = []
    mdef = {**data["definition"], "name": data["name"]}
    custom_metrics[dataset_id] = [m for m in custom_metrics[dataset_id] if m.get("name") != data["name"]]
    custom_metrics[dataset_id].append(mdef)
    add_audit_log(dataset_id, "library_import", f"Imported metric '{data['name']}' from library")
    return {"message": f"Imported '{data['name']}' into project", "metric": mdef}


@app.get("/api/library/metrics/{metric_id}/usage")
async def get_metric_usage(metric_id: str):
    """Get usage count and info for a library metric."""
    filepath = LIBRARY_DIR / f"{metric_id}.json"
    if not filepath.exists():
        raise HTTPException(404, "Metric not found in library")
    data = json.loads(filepath.read_text())
    return {"id": metric_id, "name": data.get("name"), "usage_count": data.get("usage_count", 0)}


# ═══════════════════════════════════════════════════
# Module F: Project Save/Load
# ═══════════════════════════════════════════════════

class ProjectData(BaseModel):
    name: str
    config: dict
    password: Optional[str] = None


@app.post("/api/project/save")
async def save_project(project: ProjectData, x_user_id: Optional[str] = Header(None), x_user_role: Optional[str] = Header(None)):
    project_id = str(uuid.uuid4())
    safe_name = "".join(c for c in project.name if c.isalnum() or c in " _-").strip()
    if not safe_name:
        safe_name = "project"
    projects_dir = get_user_projects_dir(x_user_id)
    filepath = projects_dir / f"{safe_name}.tableforge"
    timestamp = datetime.now().isoformat()

    # Keep version history — load existing file if present
    existing_versions = []
    if filepath.exists():
        try:
            existing_data = json.loads(filepath.read_text())
            existing_versions = existing_data.get("versions", [])
            # Keep at most 10 versions
            existing_versions = existing_versions[-9:]
            # Archive current state
            if "meta" in existing_data:
                existing_versions.append({
                    "saved_at": existing_data["meta"].get("created", ""),
                    "tables": existing_data.get("tables", []),
                    "annotationsMap": existing_data.get("annotationsMap", {}),
                })
        except Exception:
            pass

    # Build source_file fingerprint from current dataset (if any)
    source_file = None
    dataset_id = project.config.get("dataset_id") or project.config.get("source_file", {}).get("dataset_id")
    if dataset_id and dataset_id in datasets:
        ds = datasets[dataset_id]
        df_shape = ds["df"].shape if "df" in ds else (0, 0)
        cache_path = None
        for ext in ("xlsx", "xls", "csv", "tsv"):
            p = CACHE_DIR / f"{dataset_id}.{ext}"
            if p.exists():
                cache_path = str(p); break
        # Copy source file to projects dir for persistence
        project_file_path = cache_path
        if cache_path:
            src_p = Path(cache_path)
            if src_p.exists():
                dest_p = PROJECTS_DIR / f"{safe_name}_data{src_p.suffix}"
                if not dest_p.exists() or dest_p.stat().st_size != src_p.stat().st_size:
                    import shutil
                    shutil.copy2(str(src_p), str(dest_p))
                project_file_path = str(dest_p)
        source_file = {
            "filename": ds.get("filename", ""),
            "row_count": int(df_shape[0]),
            "col_count": int(df_shape[1]),
            "cache_path": project_file_path,
            "dataset_id": dataset_id,
        }
    # Allow frontend-provided source_file (e.g. including the user-picked path) to override/merge
    if "source_file" in project.config and isinstance(project.config["source_file"], dict):
        fe_sf = project.config["source_file"]
        if source_file:
            source_file = {**source_file, **{k: v for k, v in fe_sf.items() if v}}
        else:
            source_file = fe_sf

    data = {
        "meta": {
            "name": project.name,
            "id": project_id,
            "version": "2.1",
            "created": timestamp,
            "password_protected": bool(project.password),
            "source_file": source_file,
        },
        "versions": existing_versions,
        **project.config,
    }

    if project.password:
        import base64, hashlib
        # Simple XOR-based obfuscation with password hash as key
        raw = json.dumps(data).encode("utf-8")
        key = hashlib.sha256(project.password.encode()).digest()
        enc = bytes([b ^ key[i % len(key)] for i, b in enumerate(raw)])
        filepath.write_text(json.dumps({"encrypted": True, "data": base64.b64encode(enc).decode()}))
    else:
        filepath.write_text(json.dumps(data, indent=2))
    add_audit_log(project.config.get("dataset_id", ""), "project_save", f"Saved project: {project.name}")
    return {"project_id": project_id, "path": str(filepath)}


@app.get("/api/projects")
async def list_projects(x_user_id: Optional[str] = Header(None), x_user_role: Optional[str] = Header(None)):
    projects = []

    def scan_dir(d: Path):
        for f in d.glob("*.tableforge"):
            try:
                data = json.loads(f.read_text())
                meta = data.get("meta", {})
                projects.append({
                    "name": meta.get("name", f.stem),
                    "path": str(f),
                    "created": meta.get("created", ""),
                    "version_count": len(data.get("versions", [])),
                    "source_file": meta.get("source_file") or None,
                    "owner_id": f.parent.name if f.parent != PROJECTS_DIR else None,
                })
            except Exception:
                pass

    if is_super_admin(x_user_role):
        # Super admin sees all projects (shared + all user dirs)
        scan_dir(PROJECTS_DIR)
        for user_dir in PROJECTS_DIR.iterdir():
            if user_dir.is_dir():
                scan_dir(user_dir)
    elif x_user_id:
        # Regular user sees only their own projects
        user_dir = get_user_projects_dir(x_user_id)
        scan_dir(user_dir)
    else:
        # No auth: show shared projects (backward compat for local dev)
        scan_dir(PROJECTS_DIR)

    return {"projects": sorted(projects, key=lambda p: p.get("created", ""), reverse=True), "projects_dir": str(PROJECTS_DIR)}


@app.get("/api/project/versions")
async def get_project_versions(path: str):
    """Get version history for a project."""
    p = Path(path)
    if not p.exists():
        raise HTTPException(404, "Project not found")
    data = json.loads(p.read_text())
    return {"versions": data.get("versions", [])}


class RollbackRequest(BaseModel):
    path: str
    version_index: int  # index into the versions array


@app.post("/api/project/rollback")
async def rollback_project(req: RollbackRequest):
    """Restore a specific version as the current project state."""
    p = Path(req.path)
    if not p.exists():
        raise HTTPException(404, "Project not found")
    data = json.loads(p.read_text())
    if data.get("encrypted"):
        raise HTTPException(400, "Cannot rollback encrypted projects without password")

    versions = data.get("versions", [])
    if req.version_index < 0 or req.version_index >= len(versions):
        raise HTTPException(400, f"Invalid version index: {req.version_index}")

    target_version = versions[req.version_index]

    # Archive the current state before rolling back
    current_snapshot = {
        "saved_at": data.get("meta", {}).get("created", ""),
        "tables": data.get("tables", []),
        "annotationsMap": data.get("annotationsMap", {}),
    }
    # Keep all versions, add current as new version entry, cap at 10
    all_versions = versions[:] + [current_snapshot]
    all_versions = all_versions[-10:]

    # Restore the target version as current
    timestamp = datetime.now().isoformat()
    data["tables"] = target_version.get("tables", [])
    data["annotationsMap"] = target_version.get("annotationsMap", {})
    data["meta"]["created"] = timestamp
    data["versions"] = all_versions

    p.write_text(json.dumps(data, indent=2))
    add_audit_log("", "project_rollback", f"Rolled back project {p.stem} to version {req.version_index}")
    return {
        "status": "ok",
        "tables": data["tables"],
        "annotationsMap": data.get("annotationsMap", {}),
    }


class ProjectLoadRequest(BaseModel):
    path: str
    password: Optional[str] = None


@app.get("/api/project/load")
async def load_project(path: str, password: Optional[str] = None, x_user_id: Optional[str] = Header(None), x_user_role: Optional[str] = Header(None)):
    p = Path(path)
    if not p.exists():
        raise HTTPException(404, "Project file not found")
    # Access control: users can only load their own projects unless super admin
    if x_user_id and not is_super_admin(x_user_role):
        user_dir = get_user_projects_dir(x_user_id)
        if not str(p.resolve()).startswith(str(user_dir.resolve())):
            raise HTTPException(403, "Access denied: you can only access your own projects")
    raw = json.loads(p.read_text())
    if raw.get("encrypted"):
        if not password:
            raise HTTPException(403, "Password required for this project file")
        import base64, hashlib
        try:
            enc = base64.b64decode(raw["data"])
            key = hashlib.sha256(password.encode()).digest()
            dec = bytes([b ^ key[i % len(key)] for i, b in enumerate(enc)])
            return json.loads(dec.decode("utf-8"))
        except Exception:
            raise HTTPException(403, "Incorrect password")
    return raw


@app.post("/api/project/reload-file")
async def reload_project_file(body: dict):
    """Re-import the cached source file associated with a project."""
    cache_path = body.get("cache_path") or ""
    dataset_id_hint = body.get("dataset_id") or ""
    filename = body.get("filename") or "unknown"

    # Try to find the cached file
    p = Path(cache_path) if cache_path else None
    if not p or not p.exists():
        # Fallback: search cache dir by dataset_id
        for ext in ("xlsx", "xls", "csv", "tsv"):
            candidate = CACHE_DIR / f"{dataset_id_hint}.{ext}"
            if candidate.exists():
                p = candidate
                break
    if not p or not p.exists():
        raise HTTPException(404, "Source file not found in cache. Please re-import the file manually.")

    ext = p.suffix.lstrip(".").lower()
    dataset_id = str(uuid.uuid4())

    try:
        if ext in ("xlsx", "xls"):
            xls = pd.ExcelFile(p, engine="openpyxl" if ext == "xlsx" else "xlrd")
            sheets = xls.sheet_names
            df = pd.read_excel(xls, sheet_name=sheets[0])
        elif ext in ("csv", "tsv"):
            sep = "\t" if ext == "tsv" else ","
            df = pd.read_csv(p, sep=sep)
        else:
            raise HTTPException(400, f"Unsupported file format: .{ext}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Failed to read cached file: {str(e)}")

    columns = []
    for col in df.columns:
        dtype = str(df[col].dtype)
        if "int" in dtype or "float" in dtype:
            col_type = "numeric"
        elif "datetime" in dtype:
            col_type = "date"
        elif "bool" in dtype:
            col_type = "boolean"
        else:
            col_type = "text"
        sample = df[col].dropna().head(5).astype(str).tolist()
        stats = {"nulls": int(df[col].isna().sum()), "unique": int(df[col].nunique())}
        if col_type == "numeric":
            stats.update({"min": df[col].min(), "max": df[col].max(), "mean": float(df[col].mean()) if not df[col].isna().all() else None})
        columns.append({"name": col, "type": col_type, "sample_values": sample, "stats": stats})

    datasets[dataset_id] = {"df": df, "filename": filename, "sheets": [sheets[0]] if ext in ("xlsx", "xls") else [], "columns": columns}

    return {
        "dataset_id": dataset_id,
        "filename": filename,
        "sheets": datasets[dataset_id].get("sheets", []),
        "row_count": len(df),
        "columns": columns,
        "preview": df.head(20).fillna("").to_dict(orient="records"),
    }


class BatchProcessConfig(BaseModel):
    project_path: str
    file_paths: list[str]    # list of absolute file paths to process
    export_format: str = "xlsx"
    output_folder: str = ""  # optional override; defaults to EXPORTS_DIR


@app.post("/api/project/batch")
async def batch_process(config: BatchProcessConfig):
    """Apply a project template to multiple files and export each."""
    p = Path(config.project_path)
    if not p.exists():
        raise HTTPException(404, "Project file not found")

    project_data = json.loads(p.read_text())
    tables_config = project_data.get("tables", [])
    if not tables_config:
        raise HTTPException(400, "Project has no tables to process")

    output_dir = Path(config.output_folder) if config.output_folder else EXPORTS_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for file_path in config.file_paths:
        fp = Path(file_path)
        if not fp.exists():
            results.append({"file": fp.name, "status": "error", "message": "File not found"})
            continue
        try:
            # Load file into a temporary dataset
            if fp.suffix.lower() in ['.xlsx', '.xls']:
                df = pd.read_excel(fp)
            elif fp.suffix.lower() in ['.csv', '.tsv']:
                df = pd.read_csv(fp)
            else:
                results.append({"file": fp.name, "status": "error", "message": "Unsupported format"})
                continue

            temp_id = f"batch_{uuid.uuid4().hex[:8]}"
            datasets[temp_id] = {
                "df": df, "filename": fp.name, "filepath": str(fp),
                "sheets": [fp.stem], "current_sheet": fp.stem,
            }

            # Tabulate each table in the project
            export_tables_data = []
            df_cols = list(df.columns)
            for t in tables_config:
                tab_config = TableConfig(
                    dataset_id=temp_id,
                    rows=t.get("rows", []),
                    columns=t.get("columns", []),
                    values=t.get("values", []),
                    filters=t.get("filters", {}),
                    grand_total=t.get("grand_total", True),
                    subtotals=t.get("subtotals", False),
                    missing_data=t.get("missing_data", ""),
                )
                # Only tabulate if all fields exist in dataset
                all_fields = tab_config.rows + tab_config.columns + [v["field"] if isinstance(v, dict) else v.get("field","") for v in tab_config.values]
                if all(f in df_cols for f in all_fields) and all_fields:
                    try:
                        tab_result = await tabulate(tab_config)
                        export_tables_data.append({
                            "name": t.get("name", "Table"),
                            "headers": tab_result.get("headers", []),
                            "rows": tab_result.get("rows", []),
                            "title": t.get("title", ""),
                            "subtitle": t.get("subtitle", ""),
                        })
                    except Exception:
                        pass

            # Export
            if export_tables_data:
                out_filename = f"{fp.stem}_output"
                ec = ExportConfig(dataset_id=temp_id, tables=export_tables_data,
                                  format=config.export_format, filename=out_filename)
                if config.export_format == "xlsx":
                    out = await export_excel(ec)
                elif config.export_format == "docx":
                    out = await export_word(ec)
                elif config.export_format == "pdf":
                    out = await export_pdf(ec)
                else:
                    out = await export_csv(ec)
                # Move to output_dir
                src = EXPORTS_DIR / out.get("download_filename", "")
                if src.exists() and output_dir != EXPORTS_DIR:
                    import shutil
                    shutil.move(str(src), str(output_dir / src.name))
                results.append({"file": fp.name, "status": "ok", "output": out_filename})
            else:
                results.append({"file": fp.name, "status": "skipped", "message": "No fields matched"})

            # Clean up temp dataset
            del datasets[temp_id]
        except Exception as e:
            results.append({"file": fp.name, "status": "error", "message": str(e)})

    return {"results": results, "processed": len([r for r in results if r["status"] == "ok"])}


# ═══════════════════════════════════════════════════
# Module E: Export Engine
# ═══════════════════════════════════════════════════

class ExportConfig(BaseModel):
    dataset_id: str
    tables: list[dict]  # [{"name": "...", "headers": [...], "rows": [...], "title": "...", "subtitle": "..."}]
    format: str = "xlsx"
    filename: str = "TableForge_Export"
    options: dict = {}  # cover_page, cover_title, header_text, footer_text, page_numbers, include_raw_data, landscape


@app.post("/api/export")
async def export_tables(config: ExportConfig):
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    if config.format == "xlsx":
        return await export_excel(config)
    elif config.format == "docx":
        return await export_word(config)
    elif config.format == "csv":
        return await export_csv(config)
    elif config.format == "pdf":
        return await export_pdf(config)
    elif config.format == "python":
        return await export_python_script(config)
    else:
        raise HTTPException(400, f"Unsupported format: {config.format}")


async def export_excel(config: ExportConfig):
    """Export with full formatting using openpyxl."""
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    output_path = EXPORTS_DIR / f"{config.filename}.xlsx"

    from openpyxl import Workbook
    wb = Workbook()
    wb.remove(wb.active)

    header_fill = PatternFill(start_color="1e293b", end_color="1e293b", fill_type="solid")
    header_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
    data_font = Font(name="Segoe UI", size=10)
    total_fill = PatternFill(start_color="e8f0fe", end_color="e8f0fe", fill_type="solid")
    total_font = Font(name="Segoe UI", size=10, bold=True)
    thin_border = Border(
        left=Side(style="thin", color="D0D0D0"),
        right=Side(style="thin", color="D0D0D0"),
        top=Side(style="thin", color="D0D0D0"),
        bottom=Side(style="thin", color="D0D0D0"),
    )

    for t_idx, t in enumerate(config.tables):
        name = t.get("name", f"Table {t_idx + 1}")[:31]
        ws = wb.create_sheet(title=name)
        headers = t.get("headers", [])
        rows = t.get("rows", [])
        title = t.get("title", "")
        subtitle = t.get("subtitle", "")

        row_offset = 1
        # Title
        if title:
            ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=max(len(headers), 1))
            cell = ws.cell(row=1, column=1, value=title)
            cell.font = Font(name="Segoe UI", size=14, bold=True)
            row_offset = 2
        if subtitle:
            ws.merge_cells(start_row=row_offset, start_column=1, end_row=row_offset, end_column=max(len(headers), 1))
            cell = ws.cell(row=row_offset, column=1, value=subtitle)
            cell.font = Font(name="Segoe UI", size=11, color="666666")
            row_offset += 1
        if title or subtitle:
            row_offset += 1  # Blank row

        # Apply header renames if present
        header_renames = t.get("header_renames") or {}
        headers = [header_renames.get(h, h) for h in headers]

        # Headers
        for ci, h in enumerate(headers, 1):
            cell = ws.cell(row=row_offset, column=ci, value=h)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = thin_border

        # Build annotation lookup for this table
        ann_lookup = {}
        for ann in t.get("annotations", []):
            ann_lookup[(ann["rowIdx"], ann["colIdx"])] = ann.get("text", "")

        # Data rows
        for ri, row in enumerate(rows, row_offset + 1):
            is_total = (len(row) > 0 and str(row[0]) == "Grand Total")
            data_ri = ri - row_offset - 1  # 0-based index into rows
            for ci, val in enumerate(row, 1):
                cell = ws.cell(row=ri, column=ci, value=val)
                cell.font = total_font if is_total else data_font
                cell.border = thin_border
                if is_total:
                    cell.fill = total_fill
                if isinstance(val, (int, float)):
                    cell.alignment = Alignment(horizontal="right")
                    cell.number_format = '#,##0.00' if isinstance(val, float) else '#,##0'
                # Add cell comment if annotation exists
                ann_text = ann_lookup.get((data_ri, ci - 1))
                if ann_text:
                    from openpyxl.comments import Comment
                    comment = Comment(ann_text, "TableForge")
                    comment.width = 200
                    comment.height = 100
                    cell.comment = comment

        # Auto-fit column widths
        for ci in range(1, len(headers) + 1):
            max_len = max(
                (len(str(ws.cell(row=r, column=ci).value or "")) for r in range(row_offset, row_offset + len(rows) + 1)),
                default=10
            )
            ws.column_dimensions[get_column_letter(ci)].width = min(max(max_len + 2, 10), 40)

    # Formula-based sheet (additional sheet with SUM/AVERAGE formulas referencing raw data)
    if config.options.get("formula_export") and config.dataset_id in datasets:
        raw_df = datasets[config.dataset_id]["df"]
        formula_ws = wb.create_sheet(title="Formulas")
        formula_ws.cell(row=1, column=1, value="Formula Sheet — references Raw Data sheet")
        formula_ws.cell(row=1, column=1).font = Font(bold=True, name="Segoe UI")
        # Add SUM formulas for numeric columns
        numeric_cols = [c for c in raw_df.columns if str(raw_df[c].dtype) in ("int64", "float64")]
        formula_ws.cell(row=2, column=1, value="Column").font = Font(bold=True)
        formula_ws.cell(row=2, column=2, value="SUM").font = Font(bold=True)
        formula_ws.cell(row=2, column=3, value="AVERAGE").font = Font(bold=True)
        formula_ws.cell(row=2, column=4, value="COUNT").font = Font(bold=True)
        for r, col in enumerate(numeric_cols, 3):
            if "Raw Data" in [ws.title for ws in wb.worksheets]:
                col_letter = get_column_letter(list(raw_df.columns).index(col) + 1)
                n_rows = len(raw_df)
                formula_ws.cell(row=r, column=1, value=col)
                formula_ws.cell(row=r, column=2, value=f"='Raw Data'!{col_letter}2:{col_letter}{n_rows+1}")
                formula_ws.cell(row=r, column=3, value=f"=AVERAGE('Raw Data'!{col_letter}2:{col_letter}{n_rows+1})")
                formula_ws.cell(row=r, column=4, value=f"=COUNT('Raw Data'!{col_letter}2:{col_letter}{n_rows+1})")
            else:
                formula_ws.cell(row=r, column=1, value=col)
                formula_ws.cell(row=r, column=2, value=float(raw_df[col].sum()))
                formula_ws.cell(row=r, column=3, value=float(raw_df[col].mean()))
                formula_ws.cell(row=r, column=4, value=int(raw_df[col].count()))

    # Raw data sheet
    if config.options.get("include_raw_data") and config.dataset_id in datasets:
        raw_df = datasets[config.dataset_id]["df"]
        raw_ws = wb.create_sheet(title="Raw Data")
        for ci, col in enumerate(raw_df.columns, 1):
            cell = raw_ws.cell(row=1, column=ci, value=col)
            cell.font = header_font
            cell.fill = header_fill
        for ri, row in enumerate(raw_df.head(10000).values.tolist(), 2):
            for ci, val in enumerate(row, 1):
                raw_ws.cell(row=ri, column=ci, value=val if not (isinstance(val, float) and (np.isnan(val) or np.isinf(val))) else None)

    wb.save(output_path)
    fname = output_path.name
    return {"path": str(output_path), "message": f"Exported to {fname}", "download_filename": fname}


async def export_word(config: ExportConfig):
    """Export tables to a Word document with formatting."""
    from docx import Document as DocxDocument
    from docx.shared import Inches, Pt, Cm, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT

    output_path = EXPORTS_DIR / f"{config.filename}.docx"
    doc = DocxDocument()
    opts = config.options or {}

    # Page setup
    from docx.enum.section import WD_ORIENT
    for section in doc.sections:
        section.top_margin = Cm(2)
        section.bottom_margin = Cm(2)
        section.left_margin = Cm(2)
        section.right_margin = Cm(2)
        if opts.get("landscape"):
            section.orientation = WD_ORIENT.LANDSCAPE
            section.page_width, section.page_height = section.page_height, section.page_width

    # Cover page
    if opts.get("cover_page"):
        cover_p = doc.add_paragraph()
        cover_p.add_run("\n\n\n\n")
        cover_h = doc.add_heading(opts.get("cover_title") or config.filename, level=1)
        cover_h.runs[0].font.size = Pt(28)
        if opts.get("cover_subtitle"):
            cs = doc.add_paragraph(opts["cover_subtitle"])
            cs.runs[0].font.size = Pt(14)
            cs.runs[0].font.color.rgb = RGBColor(80, 80, 80)
        doc.add_paragraph(f"\nGenerated: {datetime.now().strftime('%B %d, %Y')}")
        doc.add_page_break()

    # Header / footer
    if opts.get("header_text") or opts.get("footer_text") or opts.get("page_numbers"):
        from docx.oxml.ns import qn
        for section in doc.sections:
            if opts.get("header_text"):
                header = section.header
                hp = header.paragraphs[0] if header.paragraphs else header.add_paragraph()
                hp.text = opts["header_text"]
                hp.runs[0].font.size = Pt(9) if hp.runs else None
            if opts.get("footer_text") or opts.get("page_numbers"):
                footer = section.footer
                fp = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
                fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
                txt = opts.get("footer_text", "")
                if opts.get("page_numbers"):
                    txt = (txt + "  " if txt else "") + "Page "
                if txt:
                    fp.add_run(txt)
                if opts.get("page_numbers"):
                    from docx.oxml import OxmlElement
                    fldChar = OxmlElement('w:fldChar')
                    fldChar.set(qn('w:fldCharType'), 'begin')
                    instrText = OxmlElement('w:instrText')
                    instrText.text = "PAGE"
                    fldChar2 = OxmlElement('w:fldChar')
                    fldChar2.set(qn('w:fldCharType'), 'end')
                    run = fp.add_run()
                    run._r.append(fldChar)
                    run._r.append(instrText)
                    run._r.append(fldChar2)

    for t_idx, t in enumerate(config.tables):
        if t_idx > 0:
            doc.add_page_break()

        title = t.get("title", t.get("name", f"Table {t_idx + 1}"))
        subtitle = t.get("subtitle", "")
        headers = t.get("headers", [])
        rows = t.get("rows", [])

        # Title
        p = doc.add_heading(title, level=2)
        if subtitle:
            p = doc.add_paragraph(subtitle)
            p.style.font.size = Pt(10)
            p.style.font.color.rgb = RGBColor(100, 100, 100)

        if not headers:
            continue

        # Table
        table = doc.add_table(rows=1 + len(rows), cols=len(headers))
        table.style = "Table Grid"
        table.alignment = WD_TABLE_ALIGNMENT.CENTER

        # Header row
        for ci, h in enumerate(headers):
            cell = table.rows[0].cells[ci]
            cell.text = str(h)
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.runs[0] if p.runs else p.add_run(str(h))
            run.bold = True
            run.font.size = Pt(9)
            run.font.name = "Segoe UI"

        # Build annotation lookup for footnotes
        ann_lookup = {}
        ann_list = []
        for ann in t.get("annotations", []):
            key = (ann["rowIdx"], ann["colIdx"])
            ann_lookup[key] = len(ann_list) + 1
            ann_list.append(ann.get("text", ""))

        # Data rows
        for ri, row in enumerate(rows):
            for ci, val in enumerate(row):
                cell = table.rows[ri + 1].cells[ci]
                display = ""
                if val is not None:
                    if isinstance(val, float):
                        display = f"{val:,.2f}"
                    elif isinstance(val, int):
                        display = f"{val:,}"
                    else:
                        display = str(val)
                # Add footnote marker if annotation
                ann_num = ann_lookup.get((ri, ci))
                if ann_num:
                    display = f"{display} [{ann_num}]"
                cell.text = display
                p = cell.paragraphs[0]
                if isinstance(val, (int, float)):
                    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                run = p.runs[0] if p.runs else p.add_run(display)
                run.font.size = Pt(9)
                run.font.name = "Segoe UI"
                if str(row[0]) == "Grand Total":
                    run.bold = True

        # Add annotation footnotes below table
        if ann_list:
            fn_para = doc.add_paragraph()
            fn_run = fn_para.add_run("Annotations:")
            fn_run.bold = True
            fn_run.font.size = Pt(8)
            for i, ann_text in enumerate(ann_list, 1):
                fp = doc.add_paragraph(f"[{i}] {ann_text}")
                fp.runs[0].font.size = Pt(8)
                fp.runs[0].font.color.rgb = RGBColor(0x66, 0x66, 0x66)

    doc.save(output_path)
    fname = output_path.name
    return {"path": str(output_path), "message": f"Exported to {fname}", "download_filename": fname}


async def export_csv(config: ExportConfig):
    if config.tables:
        t = config.tables[0]
        output_path = EXPORTS_DIR / f"{config.filename}.csv"
        df = pd.DataFrame(t.get("rows", []), columns=t.get("headers", []))
        df.to_csv(output_path, index=False)
        fname = output_path.name
        return {"path": str(output_path), "message": f"Exported to {fname}", "download_filename": fname}
    raise HTTPException(400, "No tables to export")


async def export_pdf(config: ExportConfig):
    """Export tables as PDF using HTML+CSS rendering."""
    output_path = EXPORTS_DIR / f"{config.filename}.pdf"
    opts = config.options or {}

    # Build HTML
    html_parts = ["""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: Segoe UI, Arial, sans-serif; font-size: 11px; margin: 20px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    h2 { font-size: 14px; margin-bottom: 2px; color: #333; }
    .subtitle { font-size: 11px; color: #666; margin-bottom: 12px; }
    .footnote { font-size: 10px; color: #666; margin-top: 4px; font-style: italic; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
    th { background: #1e293b; color: #fff; padding: 6px 10px; text-align: left; font-size: 10px; }
    td { padding: 5px 10px; border-bottom: 1px solid #ddd; font-size: 10px; }
    tr.grand-total td { background: #e8f0fe; font-weight: bold; }
    tr:nth-child(even) td { background: #f9f9f9; }
    .cover { text-align: center; padding-top: 80px; page-break-after: always; }
    @media print { .cover { page-break-after: always; } }
    </style></head><body>"""]

    if opts.get("cover_page"):
        cover_title = opts.get("cover_title") or config.filename
        cover_sub = opts.get("cover_subtitle", "")
        html_parts.append(f'<div class="cover"><h1>{cover_title}</h1>')
        if cover_sub: html_parts.append(f'<p class="subtitle">{cover_sub}</p>')
        html_parts.append(f'<p style="color:#999;margin-top:40px">{datetime.now().strftime("%B %d, %Y")}</p></div>')

    if opts.get("header_text"):
        html_parts.append(f'<div style="text-align:center;color:#666;margin-bottom:16px">{opts["header_text"]}</div>')

    for t in config.tables:
        title = t.get("title", t.get("name", ""))
        subtitle = t.get("subtitle", "")
        footnote = t.get("footnote", "")
        headers = t.get("headers", [])
        rows = t.get("rows", [])

        if title: html_parts.append(f"<h2>{title}</h2>")
        if subtitle: html_parts.append(f'<p class="subtitle">{subtitle}</p>')
        if not headers: continue

        html_parts.append("<table><thead><tr>")
        for h in headers: html_parts.append(f"<th>{h}</th>")
        html_parts.append("</tr></thead><tbody>")

        for row in rows:
            is_total = len(row) > 0 and str(row[0]) == "Grand Total"
            cls = ' class="grand-total"' if is_total else ""
            html_parts.append(f"<tr{cls}>")
            for cell in row:
                display = ""
                if cell is not None:
                    if isinstance(cell, float): display = f"{cell:,.2f}"
                    elif isinstance(cell, int): display = f"{cell:,}"
                    else: display = str(cell)
                html_parts.append(f"<td>{display}</td>")
            html_parts.append("</tr>")

        html_parts.append("</tbody></table>")
        if footnote: html_parts.append(f'<p class="footnote">{footnote}</p>')

    if opts.get("footer_text"):
        html_parts.append(f'<div style="text-align:center;color:#999;margin-top:20px;font-size:10px">{opts["footer_text"]}</div>')

    html_parts.append("</body></html>")
    html_content = "".join(html_parts)

    # Try weasyprint, fall back to HTML file
    try:
        import weasyprint
        weasyprint.HTML(string=html_content).write_pdf(str(output_path))
    except ImportError:
        # Save as HTML with .pdf extension note
        html_path = EXPORTS_DIR / f"{config.filename}.html"
        html_path.write_text(html_content, encoding="utf-8")
        output_path = html_path
        fname = html_path.name
        return {"path": str(output_path), "message": f"PDF (as HTML) saved to {fname} — open and print to PDF", "download_filename": fname}

    fname = output_path.name
    return {"path": str(output_path), "message": f"PDF exported to {fname}", "download_filename": fname}


async def export_python_script(config: ExportConfig):
    """Generate a pandas Python script that reproduces the tables."""
    ds = datasets[config.dataset_id]
    source_file = ds.get("filepath", "your_file.xlsx")
    filename_base = Path(source_file).name

    lines = [
        "#!/usr/bin/env python3",
        '"""',
        f"TableForge Export — Generated script",
        f"Source file: {filename_base}",
        '"""',
        "",
        "import pandas as pd",
        "import numpy as np",
        "",
        f"# Load source data",
        f"df = pd.read_excel({repr(filename_base)})  # adjust path as needed",
        f"# df = pd.read_csv({repr(filename_base)})  # for CSV files",
        "",
    ]

    for t_idx, t in enumerate(config.tables):
        name = t.get("name", f"Table {t_idx + 1}")
        headers = t.get("headers", [])
        rows = t.get("rows", [])
        lines.append(f"# {'─' * 50}")
        lines.append(f"# {name}")
        lines.append(f"# {'─' * 50}")
        lines.append(f"# Headers: {headers}")
        lines.append(f"table_{t_idx + 1}_data = [")
        for row in rows[:5]:
            lines.append(f"    {row},")
        if len(rows) > 5:
            lines.append(f"    # ... {len(rows) - 5} more rows")
        lines.append(f"]")
        lines.append(f"table_{t_idx + 1} = pd.DataFrame(table_{t_idx + 1}_data, columns={headers})")
        lines.append(f"print('\\n{name}:')")
        lines.append(f"print(table_{t_idx + 1}.to_string(index=False))")
        lines.append("")

    lines.append("# Save to Excel")
    lines.append(f"with pd.ExcelWriter('{config.filename}.xlsx', engine='openpyxl') as writer:")
    for t_idx, t in enumerate(config.tables):
        name = t.get("name", f"Table {t_idx + 1}")
        lines.append(f"    table_{t_idx + 1}.to_excel(writer, sheet_name={repr(name[:31])}, index=False)")
    lines.append("")
    lines.append("print('\\nSaved to {}.xlsx'.format(repr(config.filename)))")

    script_content = "\n".join(lines)
    output_path = EXPORTS_DIR / f"{config.filename}.py"
    output_path.write_text(script_content, encoding="utf-8")

    add_audit_log(config.dataset_id, "export", f"Python script exported: {config.filename}.py")
    return {"message": "Python script generated", "download_filename": f"{config.filename}.py"}


# ═══════════════════════════════════════════════════
# Download exported file
# ═══════════════════════════════════════════════════

@app.get("/api/export/download/{filename}")
async def download_export(filename: str):
    filepath = EXPORTS_DIR / filename
    if not filepath.exists():
        raise HTTPException(404, "File not found")
    media_types = {
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".csv": "text/csv",
        ".pdf": "application/pdf",
        ".py": "text/x-python",
    }
    ext = filepath.suffix
    return FileResponse(filepath, media_type=media_types.get(ext, "application/octet-stream"), filename=filename)


# ═══════════════════════════════════════════════════
# Module J: Report Export
# ═══════════════════════════════════════════════════

class ReportExportConfig(BaseModel):
    dataset_id: str = ""
    elements: list[dict] = []
    filename: str = "TableForge_Report"


@app.post("/api/report/export")
async def export_report(config: ReportExportConfig):
    """Export a full structured report as Word document."""
    from docx import Document as DocxDocument
    from docx.shared import Inches, Pt, Cm, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT

    output_path = EXPORTS_DIR / f"{config.filename}.docx"
    doc = DocxDocument()

    for section in doc.sections:
        section.top_margin = Cm(2.5)
        section.bottom_margin = Cm(2.5)
        section.left_margin = Cm(2.5)
        section.right_margin = Cm(2.5)

    now_str = datetime.now().strftime("%B %d, %Y")

    for el in config.elements:
        etype = el.get("type", "text")
        text = str(el.get("text", "")).replace("{date}", now_str)

        if etype == "cover":
            doc.add_paragraph("\n\n")
            h = doc.add_heading(text or "Report", level=1)
            h.runs[0].font.size = Pt(28)
            doc.add_paragraph(f"\n{now_str}")
            doc.add_page_break()
        elif etype == "heading":
            level = el.get("level", 1)
            doc.add_heading(text, level=level)
        elif etype == "text":
            if text:
                doc.add_paragraph(text)
        elif etype == "page_break":
            doc.add_page_break()
        elif etype == "table":
            name = el.get("name", "")
            title = el.get("title", name)
            subtitle = el.get("subtitle", "")
            headers = el.get("headers", [])
            rows = el.get("rows", [])

            if title:
                tp = doc.add_heading(title, level=3)
            if subtitle:
                sp = doc.add_paragraph(subtitle)
                if sp.runs:
                    sp.runs[0].font.size = Pt(10)
                    sp.runs[0].font.color.rgb = RGBColor(80, 80, 80)

            if headers:
                tbl = doc.add_table(rows=1 + len(rows), cols=len(headers))
                tbl.style = "Table Grid"
                tbl.alignment = WD_TABLE_ALIGNMENT.CENTER

                for ci, h in enumerate(headers):
                    cell = tbl.rows[0].cells[ci]
                    cell.text = str(h)
                    p = cell.paragraphs[0]
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    run = p.runs[0] if p.runs else p.add_run(str(h))
                    run.bold = True
                    run.font.size = Pt(9)

                for ri, row in enumerate(rows):
                    is_total = len(row) > 0 and str(row[0]) == "Grand Total"
                    for ci, val in enumerate(row):
                        cell = tbl.rows[ri + 1].cells[ci]
                        display = f"{val:,.2f}" if isinstance(val, float) else f"{val:,}" if isinstance(val, int) else str(val) if val is not None else ""
                        cell.text = display
                        p = cell.paragraphs[0]
                        if isinstance(val, (int, float)):
                            p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                        run = p.runs[0] if p.runs else p.add_run(display)
                        run.font.size = Pt(9)
                        if is_total:
                            run.bold = True

    doc.save(output_path)
    fname = output_path.name
    return {"path": str(output_path), "message": f"Report exported to {fname}", "download_filename": fname}


# ═══════════════════════════════════════════════════
# Module I: Period-over-Period Comparisons
# ═══════════════════════════════════════════════════

class ComparisonConfig(BaseModel):
    dataset_id: str
    date_column: str
    value_column: str
    group_by: list[str] = []
    comparisons: list[str] = []  # prev_period, abs_change, pct_change, yoy_value, yoy_abs, yoy_pct, period_avg, deviation, cum_ytd, moving_avg
    moving_avg_n: int = 3


@app.post("/api/compare")
async def period_comparison(config: ComparisonConfig):
    """Generate period-over-period comparison table."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[config.dataset_id]["df"].copy()
    df = apply_metrics_and_bins(df, config.dataset_id)

    date_col = config.date_column
    val_col = config.value_column

    if date_col not in df.columns or val_col not in df.columns:
        raise HTTPException(400, "Specified columns not found")

    try:
        # Ensure date column is datetime
        if df[date_col].dtype == 'object':
            df[date_col] = pd.to_datetime(df[date_col], errors="coerce")

        # Group and aggregate
        group_cols = [date_col] + config.group_by
        agg_df = df.groupby(group_cols, dropna=False)[val_col].sum().reset_index()
        agg_df = agg_df.sort_values(date_col)

        # If grouping, process per group
        if config.group_by:
            result_frames = []
            for name, group in agg_df.groupby(config.group_by):
                group = group.sort_values(date_col).reset_index(drop=True)
                group = _add_comparisons(group, date_col, val_col, config.comparisons, config.moving_avg_n)
                result_frames.append(group)
            result = pd.concat(result_frames, ignore_index=True)
        else:
            result = _add_comparisons(agg_df, date_col, val_col, config.comparisons, config.moving_avg_n)

        # Convert date to string for JSON
        result[date_col] = result[date_col].astype(str)

        headers = list(result.columns)
        rows = sanitize_for_json(result.fillna("").values.tolist())
        add_audit_log(config.dataset_id, "comparison", f"Period comparison on {val_col} by {date_col}")
        return {"headers": headers, "rows": rows, "row_count": len(rows), "col_count": len(headers)}

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Comparison error: {str(e)}")


def _add_comparisons(df: pd.DataFrame, date_col: str, val_col: str, comparisons: list, moving_n: int) -> pd.DataFrame:
    """Add comparison columns to a sorted dataframe."""
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


# ═══════════════════════════════════════════════════
# Table Annotations & Highlights
# ═══════════════════════════════════════════════════

class AnnotationData(BaseModel):
    dataset_id: str
    table_id: str
    row: int
    col: int
    text: str = ""
    color: str = ""  # highlight color


@app.post("/api/annotations/save")
async def save_annotation(data: AnnotationData):
    if data.dataset_id not in annotations:
        annotations[data.dataset_id] = {}
    table_annots = annotations[data.dataset_id].setdefault(data.table_id, [])
    # Remove existing annotation at same position
    table_annots = [a for a in table_annots if not (a["row"] == data.row and a["col"] == data.col)]
    if data.text or data.color:
        table_annots.append({"row": data.row, "col": data.col, "text": data.text, "color": data.color})
    annotations[data.dataset_id][data.table_id] = table_annots
    return {"message": "Annotation saved"}


@app.get("/api/annotations/{dataset_id}/{table_id}")
async def get_annotations(dataset_id: str, table_id: str):
    return {"annotations": annotations.get(dataset_id, {}).get(table_id, [])}


# ═══════════════════════════════════════════════════
# Audit Trail
# ═══════════════════════════════════════════════════

@app.get("/api/audit/{dataset_id}")
async def get_audit_log(dataset_id: str):
    return {"logs": audit_logs.get(dataset_id, [])}


# ═══════════════════════════════════════════════════
# Cell Drill-Down
# ═══════════════════════════════════════════════════

class DrillDownConfig(BaseModel):
    dataset_id: str
    rows: list[str] = []
    columns: list[str] = []
    values: list[dict] = []
    filters: dict = {}
    cell_row_values: dict = {}   # {row_field: value} identifying the clicked cell
    cell_col_values: dict = {}   # {col_field: value}


@app.post("/api/drilldown")
async def drill_down(config: DrillDownConfig):
    """Return source rows contributing to a specific cell value."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")

    df = datasets[config.dataset_id]["df"].copy()
    df = apply_metrics_and_bins(df, config.dataset_id)

    # Apply table-level filters
    for col, vals in config.filters.items():
        if vals and col in df.columns:
            df = df[df[col].astype(str).isin([str(v) for v in vals])]

    # Apply cell-level filters (row dimension values)
    for col, val in config.cell_row_values.items():
        if col in df.columns:
            df = df[df[col].astype(str) == str(val)]

    # Apply cell-level filters (column dimension values)
    for col, val in config.cell_col_values.items():
        if col in df.columns:
            df = df[df[col].astype(str) == str(val)]

    # Return first 100 source rows
    preview = df.head(100)
    headers = list(preview.columns)
    rows = sanitize_for_json(preview.fillna("").values.tolist())
    return {"headers": headers, "rows": rows, "row_count": len(df), "showing": len(preview)}


# ═══════════════════════════════════════════════════
# Statistical Table Generators
# ═══════════════════════════════════════════════════

class StatTableConfig(BaseModel):
    dataset_id: str
    columns: list[str] = []
    group_by: str = ""
    filters: dict = {}

@app.post("/api/stat/correlation")
async def stat_correlation(config: StatTableConfig):
    """Generate correlation matrix for selected numeric columns."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        # Filter
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]
        # Select numeric columns
        num_cols = config.columns if config.columns else [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
        if len(num_cols) < 2:
            raise HTTPException(400, "Need at least 2 numeric columns for correlation")
        corr = df[num_cols].corr().round(4)
        headers = [""] + list(corr.columns)
        rows = []
        for idx, row in corr.iterrows():
            rows.append([str(idx)] + [round(v, 4) if not pd.isna(v) else None for v in row])
        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows), "col_count": len(headers), "table_type": "correlation"}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Correlation error: {str(e)}")


@app.post("/api/stat/descriptive")
async def stat_descriptive(config: StatTableConfig):
    """Generate descriptive statistics table (Table 1 style)."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        num_cols = config.columns if config.columns else [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
        if not num_cols:
            raise HTTPException(400, "No numeric columns found")

        stats = df[num_cols].describe().T
        stats["missing"] = df[num_cols].isnull().sum().values
        stats["missing_%"] = (df[num_cols].isnull().sum() / len(df) * 100).round(2).values

        headers = ["Variable", "N", "Mean", "Std Dev", "Min", "25%", "50%", "75%", "Max", "Missing", "Missing %"]
        rows = []
        for var_name in stats.index:
            s = stats.loc[var_name]
            rows.append([
                str(var_name),
                int(s["count"]) if not pd.isna(s["count"]) else 0,
                round(s["mean"], 4) if not pd.isna(s["mean"]) else None,
                round(s["std"], 4) if not pd.isna(s["std"]) else None,
                round(s["min"], 4) if not pd.isna(s["min"]) else None,
                round(s["25%"], 4) if not pd.isna(s["25%"]) else None,
                round(s["50%"], 4) if not pd.isna(s["50%"]) else None,
                round(s["75%"], 4) if not pd.isna(s["75%"]) else None,
                round(s["max"], 4) if not pd.isna(s["max"]) else None,
                int(s["missing"]) if not pd.isna(s["missing"]) else 0,
                round(s["missing_%"], 2) if not pd.isna(s["missing_%"]) else 0,
            ])
        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows), "col_count": len(headers), "table_type": "descriptive"}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Descriptive stats error: {str(e)}")


@app.post("/api/stat/crosstab")
async def stat_crosstab(config: StatTableConfig):
    """Generate cross-tabulation with chi-square test."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        if len(config.columns) < 2:
            raise HTTPException(400, "Need exactly 2 categorical columns for cross-tab")

        row_col, col_col = config.columns[0], config.columns[1]
        ct = pd.crosstab(df[row_col], df[col_col], margins=True, margins_name="Total")

        # Chi-square test
        from scipy.stats import chi2_contingency
        ct_no_margins = pd.crosstab(df[row_col], df[col_col])
        chi2, p_value, dof, expected = chi2_contingency(ct_no_margins)

        headers = [""] + [str(c) for c in ct.columns]
        rows = []
        for idx, row in ct.iterrows():
            rows.append([str(idx)] + [int(v) if not pd.isna(v) else 0 for v in row])

        # Add test results as footer rows
        rows.append(["", "", "", "", ""])  # spacer
        rows.append(["Chi-Square", round(chi2, 4)] + [""] * (len(headers) - 2))
        rows.append(["p-value", round(p_value, 6)] + [""] * (len(headers) - 2))
        rows.append(["df", int(dof)] + [""] * (len(headers) - 2))
        sig = "***" if p_value < 0.001 else ("**" if p_value < 0.01 else ("*" if p_value < 0.05 else "ns"))
        rows.append(["Significance", sig] + [""] * (len(headers) - 2))

        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows), "col_count": len(headers),
                "table_type": "crosstab", "chi2": round(chi2, 4), "p_value": round(p_value, 6), "dof": int(dof)}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Cross-tab error: {str(e)}")


@app.post("/api/stat/ttest")
async def stat_ttest(config: StatTableConfig):
    """Perform t-test or Mann-Whitney U test between two groups."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        if len(config.columns) < 2:
            raise HTTPException(400, "Need group column and value column")

        group_col, value_col = config.columns[0], config.columns[1]
        groups = df[group_col].dropna().unique()
        if len(groups) < 2:
            raise HTTPException(400, "Need at least 2 groups for comparison")

        from scipy.stats import ttest_ind, mannwhitneyu, shapiro

        results_rows = []
        headers = ["Comparison", "Group 1 Mean", "Group 2 Mean", "Difference", "t-stat", "p-value", "Sig", "Test Used"]

        # Pairwise comparisons for first few groups
        group_pairs = [(groups[i], groups[j]) for i in range(min(len(groups), 5)) for j in range(i+1, min(len(groups), 5))]

        for g1, g2 in group_pairs:
            d1 = df[df[group_col] == g1][value_col].dropna()
            d2 = df[df[group_col] == g2][value_col].dropna()
            if len(d1) < 2 or len(d2) < 2:
                continue

            # Check normality
            try:
                _, p_norm1 = shapiro(d1[:5000])
                _, p_norm2 = shapiro(d2[:5000])
                is_normal = p_norm1 > 0.05 and p_norm2 > 0.05
            except:
                is_normal = len(d1) > 30 and len(d2) > 30

            if is_normal:
                stat, p_val = ttest_ind(d1, d2)
                test_name = "t-test"
            else:
                stat, p_val = mannwhitneyu(d1, d2, alternative='two-sided')
                test_name = "Mann-Whitney"

            sig = "***" if p_val < 0.001 else ("**" if p_val < 0.01 else ("*" if p_val < 0.05 else "ns"))
            results_rows.append([
                f"{g1} vs {g2}",
                round(d1.mean(), 4), round(d2.mean(), 4),
                round(d1.mean() - d2.mean(), 4),
                round(stat, 4), round(p_val, 6), sig, test_name
            ])

        return {"headers": headers, "rows": sanitize_for_json(results_rows), "row_count": len(results_rows),
                "col_count": len(headers), "table_type": "ttest"}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"t-test error: {str(e)}")


@app.post("/api/stat/anova")
async def stat_anova(config: StatTableConfig):
    """Perform one-way ANOVA."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        if len(config.columns) < 2:
            raise HTTPException(400, "Need group column and value column")

        group_col, value_col = config.columns[0], config.columns[1]
        from scipy.stats import f_oneway

        groups = df[group_col].dropna().unique()
        group_data = [df[df[group_col] == g][value_col].dropna() for g in groups]
        group_data = [g for g in group_data if len(g) > 0]

        if len(group_data) < 2:
            raise HTTPException(400, "Need at least 2 non-empty groups")

        f_stat, p_value = f_oneway(*group_data)
        sig = "***" if p_value < 0.001 else ("**" if p_value < 0.01 else ("*" if p_value < 0.05 else "ns"))

        # Build ANOVA summary table
        n_total = sum(len(g) for g in group_data)
        grand_mean = df[value_col].dropna().mean()
        ss_between = sum(len(g) * (g.mean() - grand_mean)**2 for g in group_data)
        ss_within = sum(((g - g.mean())**2).sum() for g in group_data)
        ss_total = ss_between + ss_within
        df_between = len(group_data) - 1
        df_within = n_total - len(group_data)
        ms_between = ss_between / max(df_between, 1)
        ms_within = ss_within / max(df_within, 1)

        headers = ["Source", "SS", "df", "MS", "F", "p-value", "Sig"]
        rows = [
            ["Between Groups", round(ss_between, 4), df_between, round(ms_between, 4), round(f_stat, 4), round(p_value, 6), sig],
            ["Within Groups", round(ss_within, 4), df_within, round(ms_within, 4), "", "", ""],
            ["Total", round(ss_total, 4), n_total - 1, "", "", "", ""],
        ]

        # Add group descriptives
        rows.append(["", "", "", "", "", "", ""])
        rows.append(["Group", "N", "Mean", "Std Dev", "Min", "Max", ""])
        for g_name, g_data in zip(groups, group_data):
            rows.append([
                str(g_name), len(g_data), round(g_data.mean(), 4),
                round(g_data.std(), 4), round(g_data.min(), 4), round(g_data.max(), 4), ""
            ])

        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "anova", "f_stat": round(f_stat, 4), "p_value": round(p_value, 6)}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"ANOVA error: {str(e)}")


@app.post("/api/stat/regression")
async def stat_regression(config: StatTableConfig):
    """Perform OLS linear regression. First column = dependent (Y), rest = independent (X)."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        if len(config.columns) < 2:
            raise HTTPException(400, "Need at least 1 dependent + 1 independent variable")

        y_col = config.columns[0]
        x_cols = config.columns[1:]

        # Ensure numeric
        for c in [y_col] + x_cols:
            df[c] = pd.to_numeric(df[c], errors="coerce")
        df_clean = df[[y_col] + x_cols].dropna()

        if len(df_clean) < len(x_cols) + 2:
            raise HTTPException(400, f"Not enough data points ({len(df_clean)}) for regression")

        from scipy import stats as sp_stats

        Y = df_clean[y_col].values
        X = np.column_stack([np.ones(len(Y))] + [df_clean[c].values for c in x_cols])

        # OLS: beta = (X'X)^-1 X'Y
        try:
            beta = np.linalg.lstsq(X, Y, rcond=None)[0]
        except np.linalg.LinAlgError:
            raise HTTPException(400, "Singular matrix — cannot compute regression")

        Y_pred = X @ beta
        residuals = Y - Y_pred
        n = len(Y)
        k = len(x_cols)
        ss_res = (residuals ** 2).sum()
        ss_tot = ((Y - Y.mean()) ** 2).sum()
        r_squared = 1 - ss_res / ss_tot if ss_tot != 0 else 0
        adj_r_sq = 1 - (1 - r_squared) * (n - 1) / max(n - k - 1, 1)
        mse = ss_res / max(n - k - 1, 1)
        rmse = np.sqrt(mse)

        # F-statistic
        ss_reg = ss_tot - ss_res
        f_stat = (ss_reg / max(k, 1)) / max(mse, 1e-15)
        from scipy.stats import f as f_dist
        p_f = 1 - f_dist.cdf(f_stat, k, max(n - k - 1, 1))

        # Standard errors and t-stats for coefficients
        try:
            var_beta = mse * np.linalg.inv(X.T @ X).diagonal()
            se_beta = np.sqrt(np.abs(var_beta))
        except:
            se_beta = np.zeros(k + 1)

        headers = ["Variable", "Coefficient", "Std Error", "t-Stat", "p-value", "Sig"]
        rows = []
        var_names = ["(Intercept)"] + x_cols
        for i, name in enumerate(var_names):
            coef = beta[i]
            se = se_beta[i] if i < len(se_beta) else 0
            t_stat = coef / se if se > 1e-15 else 0
            p_val = 2 * (1 - sp_stats.t.cdf(abs(t_stat), max(n - k - 1, 1)))
            sig = "***" if p_val < 0.001 else ("**" if p_val < 0.01 else ("*" if p_val < 0.05 else "ns"))
            rows.append([name, round(coef, 6), round(se, 6), round(t_stat, 4), round(p_val, 6), sig])

        summary = {
            "R²": round(r_squared, 4),
            "Adj R²": round(adj_r_sq, 4),
            "RMSE": round(rmse, 4),
            "F-stat": round(f_stat, 4),
            "p (F)": round(p_f, 6),
            "N": n,
        }
        interp = f"The model explains {r_squared*100:.1f}% of variance in {y_col}. "
        if p_f < 0.05:
            interp += f"The overall model is statistically significant (F={f_stat:.2f}, p={p_f:.4f})."
        else:
            interp += f"The overall model is NOT statistically significant (p={p_f:.4f})."

        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "regression",
                "summary": summary, "interpretation": interp}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Regression error: {str(e)}")


@app.post("/api/stat/normality")
async def stat_normality(config: StatTableConfig):
    """Test normality of selected numeric columns (Shapiro-Wilk + K-S tests)."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        num_cols = config.columns if config.columns else [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
        if not num_cols:
            raise HTTPException(400, "No numeric columns selected")

        from scipy.stats import shapiro, kstest, skew, kurtosis

        headers = ["Variable", "N", "Mean", "Std Dev", "Skewness", "Kurtosis",
                    "Shapiro W", "Shapiro p", "K-S Stat", "K-S p", "Normal?"]
        rows = []
        for col in num_cols:
            data = pd.to_numeric(df[col], errors="coerce").dropna()
            if len(data) < 3:
                rows.append([str(col), len(data)] + [None]*9)
                continue

            n = len(data)
            mean_val = data.mean()
            std_val = data.std()
            skew_val = float(skew(data))
            kurt_val = float(kurtosis(data))

            # Shapiro-Wilk (max 5000 samples)
            sample = data.values[:5000]
            try:
                sw_stat, sw_p = shapiro(sample)
            except:
                sw_stat, sw_p = None, None

            # Kolmogorov-Smirnov
            try:
                ks_stat, ks_p = kstest(data, 'norm', args=(mean_val, std_val))
            except:
                ks_stat, ks_p = None, None

            is_normal = "Yes" if (sw_p and sw_p > 0.05) else "No"

            rows.append([
                str(col), n,
                round(mean_val, 4), round(std_val, 4),
                round(skew_val, 4), round(kurt_val, 4),
                round(sw_stat, 4) if sw_stat else None,
                round(sw_p, 6) if sw_p else None,
                round(ks_stat, 4) if ks_stat else None,
                round(ks_p, 6) if ks_p else None,
                is_normal,
            ])

        normal_count = sum(1 for r in rows if r[-1] == "Yes")
        interp = f"{normal_count}/{len(rows)} variables appear normally distributed (Shapiro-Wilk p>0.05). "
        interp += "Non-normal variables may need transformation or non-parametric tests."

        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "normality", "interpretation": interp}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Normality test error: {str(e)}")


@app.post("/api/stat/outlier")
async def stat_outlier(config: StatTableConfig):
    """Detect outliers using IQR and Z-score methods."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        num_cols = config.columns if config.columns else [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
        if not num_cols:
            raise HTTPException(400, "No numeric columns selected")

        headers = ["Variable", "N", "Mean", "Std Dev", "Q1", "Q3", "IQR",
                    "Lower Fence", "Upper Fence", "IQR Outliers", "Z>3 Outliers", "% Outliers"]
        rows = []
        total_outliers = 0
        total_n = 0

        for col in num_cols:
            data = pd.to_numeric(df[col], errors="coerce").dropna()
            if len(data) < 4:
                rows.append([str(col), len(data)] + [None]*10)
                continue

            n = len(data)
            mean_val = data.mean()
            std_val = data.std()
            q1 = data.quantile(0.25)
            q3 = data.quantile(0.75)
            iqr = q3 - q1
            lower = q1 - 1.5 * iqr
            upper = q3 + 1.5 * iqr
            iqr_outliers = int(((data < lower) | (data > upper)).sum())
            z_outliers = int((((data - mean_val).abs() / max(std_val, 1e-15)) > 3).sum())
            pct = round(max(iqr_outliers, z_outliers) / n * 100, 2)
            total_outliers += max(iqr_outliers, z_outliers)
            total_n += n

            rows.append([
                str(col), n,
                round(mean_val, 4), round(std_val, 4),
                round(q1, 4), round(q3, 4), round(iqr, 4),
                round(lower, 4), round(upper, 4),
                iqr_outliers, z_outliers, pct,
            ])

        pct_total = round(total_outliers / max(total_n, 1) * 100, 2)
        interp = f"Found {total_outliers} potential outliers across {len(rows)} variables ({pct_total}% of data). "
        interp += "Consider investigating outliers before statistical analysis."

        return {"headers": headers, "rows": sanitize_for_json(rows), "row_count": len(rows),
                "col_count": len(headers), "table_type": "outlier", "interpretation": interp}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Outlier detection error: {str(e)}")


@app.post("/api/stat/frequency")
async def stat_frequency(config: StatTableConfig):
    """Generate frequency distribution table for selected columns."""
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    try:
        df = datasets[config.dataset_id]["df"].copy()
        df = apply_metrics_and_bins(df, config.dataset_id)
        for col, vals in config.filters.items():
            if vals and col in df.columns:
                df = df[df[col].astype(str).isin([str(v) for v in vals])]

        if not config.columns:
            raise HTTPException(400, "Select at least one column")

        all_rows = []
        for col_name in config.columns:
            if col_name not in df.columns:
                continue

            vc = df[col_name].fillna("(Missing)").astype(str).value_counts()
            total = vc.sum()
            cum_count = 0

            # Add column header row
            all_rows.append([f"— {col_name} —", "", "", "", ""])

            for val, count in vc.items():
                cum_count += count
                pct = round(count / total * 100, 2) if total > 0 else 0
                cum_pct = round(cum_count / total * 100, 2) if total > 0 else 0
                all_rows.append([str(val), int(count), pct, int(cum_count), cum_pct])

            all_rows.append(["Total", int(total), 100.0, int(total), 100.0])
            if col_name != config.columns[-1]:
                all_rows.append(["", "", "", "", ""])  # spacer

        headers = ["Value", "Frequency", "Percent (%)", "Cumulative Freq", "Cumulative %"]
        return {"headers": headers, "rows": sanitize_for_json(all_rows), "row_count": len(all_rows),
                "col_count": len(headers), "table_type": "frequency"}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(400, f"Frequency error: {str(e)}")


# ═══════════════════════════════════════════════════
# FieldGovern Integration
# ═══════════════════════════════════════════════════

class FGImportBody(BaseModel):
    fg_base_url: str
    program_id: str
    token: str
    questionnaire_id: Optional[str] = None

@app.post("/api/import-from-fg")
async def import_from_fg(body: FGImportBody):
    """Fetch program submissions from FieldGovern and load as a dataset, streaming progress via SSE."""
    import httpx

    async def progress_stream():
        try:
            yield f"data: {json.dumps({'step': 'connecting', 'message': 'Connecting to FieldGovern…', 'percent': 5})}\n\n"

            internal_base = os.environ.get("FG_INTERNAL_URL", "").rstrip("/")
            base = internal_base if internal_base else body.fg_base_url.rstrip("/")
            url = f"{base}/api/v1/fg/programs/{body.program_id}/export.xlsx"
            if body.questionnaire_id:
                url += f"?questionnaire_id={body.questionnaire_id}"

            yield f"data: {json.dumps({'step': 'downloading', 'message': 'Downloading data from server…', 'percent': 15})}\n\n"

            async with httpx.AsyncClient(timeout=120.0, verify=bool(not internal_base)) as client:
                resp = await client.get(url, headers={"Authorization": f"Bearer {body.token}"})

            if resp.status_code != 200:
                yield f"data: {json.dumps({'step': 'error', 'message': f'FieldGovern returned {resp.status_code}', 'percent': 0})}\n\n"
                return

            file_size = len(resp.content)
            yield f"data: {json.dumps({'step': 'saving', 'message': f'Downloaded {file_size // 1024} KB — saving…', 'percent': 40})}\n\n"

            dataset_id = str(uuid.uuid4())
            filename = f"fg_program_{body.program_id}.xlsx"
            tmp_path = CACHE_DIR / f"{dataset_id}.xlsx"
            tmp_path.write_bytes(resp.content)

            yield f"data: {json.dumps({'step': 'parsing', 'message': 'Parsing Excel file…', 'percent': 55})}\n\n"

            try:
                xls = pd.ExcelFile(tmp_path, engine="openpyxl")
                df = pd.read_excel(xls, sheet_name=xls.sheet_names[0])
            except Exception as e:
                yield f"data: {json.dumps({'step': 'error', 'message': f'Failed to parse: {str(e)}', 'percent': 0})}\n\n"
                return

            row_count = len(df)
            col_count = len(df.columns)
            yield f"data: {json.dumps({'step': 'extracting', 'message': f'Extracting {col_count} columns from {row_count} rows…', 'percent': 70})}\n\n"

            columns = []
            for i, col in enumerate(df.columns):
                dtype = str(df[col].dtype)
                if "int" in dtype or "float" in dtype:
                    col_type = "numeric"
                elif "datetime" in dtype:
                    col_type = "date"
                elif "bool" in dtype:
                    col_type = "boolean"
                else:
                    try:
                        col_type = "multi_choice" if _is_multi_choice(df[col]) else "text"
                    except Exception:
                        col_type = "text"
                sample_values = df[col].dropna().head(5).tolist()
                stats: dict = {"nulls": int(df[col].isna().sum()), "unique": int(df[col].nunique())}
                if col_type == "numeric":
                    try:
                        stats.update({
                            "min": float(df[col].min()) if not pd.isna(df[col].min()) else None,
                            "max": float(df[col].max()) if not pd.isna(df[col].max()) else None,
                            "mean": float(df[col].mean()) if not pd.isna(df[col].mean()) else None,
                        })
                    except Exception:
                        pass
                columns.append({
                    "name": col,
                    "type": col_type,
                    "sample_values": [str(v) for v in sample_values],
                    "stats": sanitize_for_json(stats),
                })

            pct = 70 + int((i + 1) / col_count * 20) if col_count > 0 else 90
            yield f"data: {json.dumps({'step': 'finalizing', 'message': f'Building dataset ({row_count} rows, {col_count} columns)…', 'percent': 92})}\n\n"

            datasets[dataset_id] = {"df": df, "filename": filename, "sheets": xls.sheet_names}
            custom_metrics[dataset_id] = []
            custom_bins[dataset_id] = []
            audit_logs[dataset_id] = []
            annotations[dataset_id] = {}
            column_type_overrides[dataset_id] = {}
            add_audit_log(dataset_id, "fg_import", f"Imported from FieldGovern program {body.program_id}: {row_count} rows")

            result = {
                "dataset_id": dataset_id,
                "filename": filename,
                "sheets": xls.sheet_names,
                "row_count": row_count,
                "columns": columns,
                "preview": sanitize_for_json(df.head(50).fillna("").to_dict(orient="records")),
            }

            yield f"data: {json.dumps({'step': 'done', 'message': 'Ready!', 'percent': 100, 'result': result})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'step': 'error', 'message': str(e), 'percent': 0})}\n\n"

    return StreamingResponse(progress_stream(), media_type="text/event-stream")


# ── FG proxy: list programs ───────────────────────────────────────────────────

class FGBaseBody(BaseModel):
    fg_base_url: str
    token: str

class FGQuestionnairesBody(BaseModel):
    fg_base_url: str
    token: str
    program_id: str

class FGSaveProjectBody(BaseModel):
    fg_base_url: str
    token: str
    tool: str
    name: str
    program_id: Optional[str] = None
    data: dict = {}

def _fg_base(external_url: str) -> tuple:
    """Return (base_url, verify_ssl) using internal Docker URL when available."""
    internal = os.environ.get("FG_INTERNAL_URL", "").rstrip("/")
    if internal:
        return internal, False
    return external_url.rstrip("/"), True

@app.post("/api/fg/programs")
async def proxy_fg_programs(body: FGBaseBody):
    import httpx
    base, verify = _fg_base(body.fg_base_url)
    url = f"{base}/api/v1/programs/"
    async with httpx.AsyncClient(timeout=30, verify=verify) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {body.token}"})
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "FieldGovern programs fetch failed")
    return resp.json()

@app.post("/api/fg/questionnaires")
async def proxy_fg_questionnaires(body: FGQuestionnairesBody):
    import httpx
    base, verify = _fg_base(body.fg_base_url)
    url = f"{base}/api/v1/programs/{body.program_id}/questionnaires"
    async with httpx.AsyncClient(timeout=30, verify=verify) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {body.token}"})
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "FieldGovern questionnaires fetch failed")
    return resp.json()

@app.post("/api/fg/user-projects/save")
async def proxy_save_fg_project(body: FGSaveProjectBody):
    import httpx
    base, verify = _fg_base(body.fg_base_url)
    url = f"{base}/api/v1/tool-projects/"
    payload = {"tool": body.tool, "name": body.name, "program_id": body.program_id, "data": body.data}
    async with httpx.AsyncClient(timeout=30, verify=verify) as client:
        resp = await client.post(url, json=payload, headers={"Authorization": f"Bearer {body.token}"})
    if resp.status_code not in (200, 201):
        raise HTTPException(resp.status_code, "Failed to save project to FieldGovern")
    return resp.json()

@app.post("/api/fg/user-projects/list")
async def proxy_list_fg_projects(body: FGBaseBody):
    import httpx
    base, verify = _fg_base(body.fg_base_url)
    url = f"{base}/api/v1/tool-projects/?tool=analyzer"
    async with httpx.AsyncClient(timeout=30, verify=verify) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {body.token}"})
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Failed to list projects from FieldGovern")
    return resp.json()


# ═══════════════════════════════════════════════════
# Module AI: AI-Smart Features
# ═══════════════════════════════════════════════════

import re as _re

AI_CONFIG_FILE = BASE_DIR / "ai_config.json"


def _load_ai_cfg() -> dict:
    """Load AI config from file, env vars, FieldGovern API, or database."""
    if AI_CONFIG_FILE.exists():
        try:
            cfg = json.loads(AI_CONFIG_FILE.read_text())
            if cfg.get("api_key"):
                return cfg
        except Exception:
            pass
    # Fallback to env vars
    provider = os.environ.get("AI_PROVIDER", "")
    api_key = os.environ.get("AI_API_KEY", "")
    model = os.environ.get("AI_MODEL", "")
    if provider and api_key:
        return {"provider": provider, "api_key": api_key, "model": model}
    # Fallback: fetch from FieldGovern main app API (when running as sidecar)
    fg_internal = os.environ.get("FG_INTERNAL_URL", "").rstrip("/")
    if fg_internal:
        try:
            import httpx
            resp = httpx.get(f"{fg_internal}/api/v1/system-settings/ai_config", timeout=5.0)
            if resp.status_code == 200:
                cfg = resp.json()
                if isinstance(cfg, dict) and "keys" in cfg:
                    active = cfg.get("active_provider", "")
                    key_cfg = cfg.get("keys", {}).get(active, {})
                    if key_cfg.get("api_key"):
                        return {"provider": active, "api_key": key_cfg["api_key"], "model": key_cfg.get("model", "")}
                elif isinstance(cfg, dict) and cfg.get("api_key"):
                    return cfg
        except Exception:
            pass
    # Fallback: try FieldGovern's database directly (when co-deployed)
    db_url = os.environ.get("DATABASE_URL", "")
    if db_url:
        try:
            from sqlalchemy import create_engine, text
            engine = create_engine(db_url)
            with engine.connect() as conn:
                row = conn.execute(text("SELECT value FROM system_settings WHERE key = 'ai_config'")).fetchone()
                if row:
                    cfg = json.loads(row[0]) if isinstance(row[0], str) else row[0]
                    if "keys" in cfg:
                        active = cfg.get("active_provider", "")
                        key_cfg = cfg.get("keys", {}).get(active, {})
                        return {"provider": active, "api_key": key_cfg.get("api_key", ""), "model": key_cfg.get("model", "")}
                    return cfg
        except Exception:
            pass
    return {}


async def _call_llm(cfg: dict, prompt: str) -> str:
    """Call configured LLM provider."""
    provider = cfg.get("provider")
    key = cfg.get("api_key")
    model = cfg.get("model")
    if not provider or not key:
        raise HTTPException(400, "AI not configured. Set AI_PROVIDER and AI_API_KEY env vars or configure via /api/ai/config.")

    LLM_TIMEOUT = 300

    try:
        if provider == "openai":
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=key, timeout=LLM_TIMEOUT)
            r = await client.chat.completions.create(
                model=model or "gpt-4o", messages=[{"role": "user", "content": prompt}], max_tokens=4096,
            )
            return r.choices[0].message.content or ""

        elif provider == "anthropic":
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=key, timeout=LLM_TIMEOUT)
            r = await client.messages.create(
                model=model or "claude-sonnet-4-6", max_tokens=4096,
                messages=[{"role": "user", "content": prompt}],
            )
            return r.content[0].text

        elif provider == "gemini":
            import asyncio
            from google import genai
            client = genai.Client(api_key=key)
            r = await asyncio.to_thread(
                client.models.generate_content,
                model=model or "gemini-2.5-flash",
                contents=prompt,
            )
            return r.text

        elif provider == "deepseek":
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=key, base_url="https://api.deepseek.com", timeout=LLM_TIMEOUT)
            r = await client.chat.completions.create(
                model=model or "deepseek-v4-flash", messages=[{"role": "user", "content": prompt}], max_tokens=8192,
            )
            return r.choices[0].message.content or ""

        else:
            raise HTTPException(400, f"Unsupported AI provider: {provider}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"AI provider error ({provider}): {str(e)}")


AI_MODELS = {
    "gemini": [
        {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash (fast, recommended)"},
        {"id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro (best quality)"},
        {"id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash"},
        {"id": "gemini-1.5-flash", "name": "Gemini 1.5 Flash (legacy)"},
    ],
    "openai": [
        {"id": "gpt-4o", "name": "GPT-4o (recommended)"},
        {"id": "gpt-4o-mini", "name": "GPT-4o Mini (faster, cheaper)"},
        {"id": "gpt-4-turbo", "name": "GPT-4 Turbo"},
    ],
    "anthropic": [
        {"id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6 (recommended)"},
        {"id": "claude-haiku-4-5-20251001", "name": "Claude Haiku 4.5 (fast)"},
    ],
    "deepseek": [
        {"id": "deepseek-chat", "name": "DeepSeek Chat (V3)"},
        {"id": "deepseek-reasoner", "name": "DeepSeek Reasoner (R1)"},
    ],
}


@app.get("/api/ai/config")
async def get_ai_config():
    cfg = _load_ai_cfg()
    return {
        "provider": cfg.get("provider", ""),
        "model": cfg.get("model", ""),
        "configured": bool(cfg.get("api_key")),
        "has_key": bool(cfg.get("api_key")),
        "models": AI_MODELS,
    }


@app.post("/api/ai/config")
async def set_ai_config(body: dict):
    # Load existing config to preserve API key if not re-entered
    existing = {}
    if AI_CONFIG_FILE.exists():
        try: existing = json.loads(AI_CONFIG_FILE.read_text())
        except Exception: pass
    provider = body.get("provider") or existing.get("provider", "")
    api_key = body.get("api_key") or existing.get("api_key", "")
    model = body.get("model") or ""
    data = {"provider": provider, "api_key": api_key, "model": model}
    AI_CONFIG_FILE.write_text(json.dumps(data))
    return {"status": "ok", "provider": provider, "model": model}


class AIPolishRequest(BaseModel):
    dataset_id: str
    table_title: str = ""
    rows: list = []
    columns: list = []
    values: list = []
    headers: list = []
    sample_rows: list = []


@app.post("/api/ai/polish")
async def ai_polish_table(body: AIPolishRequest):
    """AI-powered title, subtitle, and column label generation."""
    cfg = _load_ai_cfg()
    groupby = body.rows[0] if body.rows else ""
    value_field = body.values[0].get("field", "*") if body.values else "*"
    aggregation = body.values[0].get("agg", "count") if body.values else "count"
    is_cross_tab = len(body.columns) > 0
    sub_keys = body.columns

    rows_preview = []
    for r in body.sample_rows[:20]:
        if isinstance(r, list):
            rows_preview.append(" | ".join(str(v) for v in r))
        elif isinstance(r, dict):
            rows_preview.append(" | ".join(f"{k}={v}" for k, v in list(r.items())[:8]))

    all_col_keys = list(dict.fromkeys([groupby] + ([value_field] if value_field != "*" else []) + sub_keys + body.headers))
    col_keys_json = json.dumps({k: f"clean label for {k}" for k in all_col_keys[:15]})

    prompt = (
        f"You are a research data analyst. A data tabulation has raw machine-generated names. Clean them up.\n\n"
        f"Raw table info:\n"
        f"- Title: {body.table_title or 'Untitled'}\n"
        f"- Row variable (groupby): {groupby}\n"
        f"- Value/column variable: {value_field}\n"
        f"- Aggregation: {aggregation}\n"
        f"- Is cross-tabulation: {is_cross_tab}\n"
        f"- Column headers: {body.headers[:15]}\n"
        f"- Sample data ({len(rows_preview)} rows):\n" +
        "\n".join(rows_preview) + "\n\n"
        f"Return ONLY valid JSON (no markdown, no explanation):\n"
        f'{{\n'
        f'  "title": "Human-readable table title",\n'
        f'  "subtitle": "One sentence: what insight this table provides",\n'
        f'  "column_labels": {col_keys_json}\n'
        f'}}\n\n'
        f"Rules:\n"
        f"- Title: concise and specific, not generic\n"
        f"- subtitle: describes the insight or finding angle\n"
        f"- column_labels: map raw field names to clean human-readable labels\n"
        f"- For '*' use 'Count' or 'Number of Records'\n"
        f"- For mean aggregation label as 'Average [field meaning]'"
    )
    raw = await _call_llm(cfg, prompt)
    match = _re.search(r'\{.*\}', raw, _re.DOTALL)
    if match:
        try:
            result = json.loads(match.group())
            if isinstance(result.get("column_labels"), dict):
                result["column_labels"] = {str(k): str(v) for k, v in result["column_labels"].items()}
            return result
        except Exception:
            pass
    return {"title": body.table_title, "subtitle": "", "column_labels": {}}


class AIInterpretRequest(BaseModel):
    dataset_id: str
    table_title: str = ""
    subtitle: str = ""
    headers: list = []
    rows_data: list = []
    row_fields: list = []
    column_fields: list = []
    value_fields: list = []
    focus: str = ""
    previous_interpretation: str = ""


@app.post("/api/ai/interpret")
async def ai_interpret_table(body: AIInterpretRequest):
    """AI-powered table interpretation — generates narrative analysis."""
    cfg = _load_ai_cfg()

    # Build table text representation
    header_line = " | ".join(body.headers[:20])
    rows_str = "\n".join(
        " | ".join(str(v) for v in row[:20])
        for row in body.rows_data[:60]
    )
    if len(body.rows_data) > 60:
        rows_str += f"\n... ({len(body.rows_data) - 60} more rows not shown)"

    default_focus = (
        "Provide a comprehensive interpretation: identify the standout finding, "
        "notable patterns or disparities, the highest and lowest values and what they suggest, "
        "any cross-variable interactions, and practical implications."
    )

    refinement_block = ""
    if body.previous_interpretation.strip():
        refinement_block = (
            f"\n--- PREVIOUS INTERPRETATION ---\n"
            f"{body.previous_interpretation.strip()}\n"
            f"--- END ---\n\n"
            f"Produce a REFINED interpretation that:\n"
            f"- Preserves accurate findings from previous version\n"
            f"- Corrects errors or vague statements\n"
            f"- Adds missed insights\n"
            f"- Sharpens language and flow\n"
            f"Output ONLY the final refined interpretation.\n"
        )

    prompt = (
        f"You are a senior data analyst writing an interpretation for a data table.\n\n"
        f"Table: {body.table_title}\n"
        f"{body.subtitle}\n"
        f"Row dimensions: {body.row_fields}\n"
        f"Column dimensions: {body.column_fields}\n"
        f"Value fields: {[v.get('field','') + ' (' + v.get('agg','sum') + ')' for v in body.value_fields]}\n\n"
        f"Data ({len(body.rows_data)} rows):\n"
        f"{header_line}\n"
        f"{'-' * max(len(header_line), 40)}\n"
        f"{rows_str}\n"
        f"{refinement_block}\n"
        f"Analyst focus: {body.focus.strip() if body.focus.strip() else default_focus}\n\n"
        f"Write a data-driven interpretation in flowing prose:\n"
        f"- Be specific — cite actual numbers from the table\n"
        f"- State the most important finding first\n"
        f"- Note outliers, unexpected gaps, or strong patterns\n"
        f"- For cross-tabs: explain interaction between variables\n"
        f"- Quantify comparisons (e.g. '3.2x higher', 'gap of 47 points')\n"
        f"- End with practical implication or recommendation\n"
        f"- Describe what the data MEANS, not what the table contains\n"
        f"- Be as detailed as the data warrants"
    )
    interpretation = await _call_llm(cfg, prompt)
    return {"interpretation": interpretation}


class AISuggestRequest(BaseModel):
    dataset_id: str
    prompt: str = ""


@app.post("/api/ai/suggest")
async def ai_suggest_tables(body: AISuggestRequest):
    """AI suggests optimal table configurations from the dataset."""
    cfg = _load_ai_cfg()
    if body.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    ds = datasets[body.dataset_id]
    df = ds["df"]

    cols_info = []
    for col in df.columns[:60]:
        dtype = str(df[col].dtype)
        uniq = int(df[col].nunique())
        sample = df[col].dropna().head(5).astype(str).tolist()
        cols_info.append({"id": col, "type": "numeric" if "int" in dtype or "float" in dtype else "text", "unique": uniq, "sample": sample})

    sample_rows = df.head(8).fillna("").to_dict(orient="records")

    prompt = (
        f"You are a research data analyst designing tabulations.\n\n"
        f"Available columns (use ONLY these ids):\n{json.dumps(cols_info, indent=1)}\n\n"
        f"Sample data rows:\n{json.dumps(sample_rows[:6])}\n\n"
        f"User request: {body.prompt or 'Suggest the most insightful tabulations for this dataset.'}\n\n"
        f"For each table decide:\n"
        f"  - groupby_field: column id to group rows by (required)\n"
        f"  - value_field: column id to aggregate, or '*' for row count\n"
        f"  - aggregation: 'count', 'sum', or 'mean'\n"
        f"  - secondary_groupby: second column for cross-tab, or ''\n"
        f"  - title: clean human-readable title\n"
        f"  - description: one sentence explaining insight\n\n"
        f"Suggest 2-5 tables. Respond with ONLY valid JSON:\n"
        f'{{"rationale": "...", "tables": [{{"title":"...","groupby_field":"...","value_field":"*","aggregation":"count","secondary_groupby":"","description":"..."}}]}}'
    )
    raw = await _call_llm(cfg, prompt)
    match = _re.search(r'\{.*\}', raw, _re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    return {"rationale": "Could not parse AI response", "tables": []}


class AISmartBuildRequest(BaseModel):
    dataset_id: str
    selected_columns: list = []
    query: str = ""


@app.post("/api/ai/smart-build")
async def ai_smart_build(body: AISmartBuildRequest):
    """AI designs one optimized table from selected columns or NL query."""
    try:
        cfg = _load_ai_cfg()
        if not cfg.get("api_key"):
            raise HTTPException(400, "AI not configured. Go to AI Settings and add your API key.")
        if body.dataset_id not in datasets:
            raise HTTPException(404, "Dataset not found")
        ds = datasets[body.dataset_id]
        df = ds["df"]

        if body.selected_columns:
            cols = [c for c in body.selected_columns if c in df.columns]
        else:
            cols = list(df.columns[:30])

        if not cols:
            raise HTTPException(400, "No valid columns found for analysis")

        cols_block = []
        for col in cols:
            dtype = str(df[col].dtype)
            try:
                uniq_vals = [str(v) for v in df[col].dropna().unique()[:12]]
            except Exception:
                uniq_vals = []
            cols_block.append(f"  - id={col} | type={'numeric' if 'int' in dtype or 'float' in dtype else 'text'} | unique values ({df[col].nunique()}): {uniq_vals}")

        sample_rows = sanitize_for_json(df[cols].head(6).fillna("").to_dict(orient="records"))

        task = f'User question: "{body.query.strip()}"\nDesign the best table to answer this.' if body.query.strip() else "Design the most insightful cross-tabulation or aggregation from these columns."

        prompt = (
            f"You are a research data analyst. Design ONE tabulation table.\n\n"
            f"Available columns:\n" + "\n".join(cols_block) + f"\n\n"
            f"Sample data:\n{json.dumps(sample_rows, ensure_ascii=False, default=str)}\n\n"
            f"{task}\n\n"
            f"Decide:\n"
            f"- groupby_field: column id for row grouping\n"
            f"- secondary_groupby: column id for cross-tab ('' if simple)\n"
            f"- value_field: column id to aggregate, or '*' for count\n"
            f"- aggregation: 'count', 'sum', or 'mean'\n"
            f"- title: clean human-readable title\n"
            f"- description: one sentence insight\n"
            f"- column_labels: mapping raw ids to clean names\n\n"
            f"Only use column ids from list. Respond ONLY valid JSON:\n"
            f'{{"groupby_field":"","secondary_groupby":"","value_field":"*","aggregation":"count","title":"","description":"","column_labels":{{}}}}'
        )
        raw = await _call_llm(cfg, prompt)
        match = _re.search(r'\{.*\}', raw, _re.DOTALL)
        if match:
            try:
                result = json.loads(match.group())
                if isinstance(result.get("column_labels"), dict):
                    result["column_labels"] = {str(k): str(v) for k, v in result["column_labels"].items()}
                return result
            except json.JSONDecodeError:
                raise HTTPException(502, "AI returned invalid JSON. Try again.")
        raise HTTPException(502, "AI returned empty response. Try again.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Smart Build failed: {str(e)}")


REPORT_STYLE_PROMPTS = {
    "progress": "You are writing a field program progress report for NGO/government management. Use clear sections: Executive Summary, Progress Against Targets, Data Quality, Issues & Resolutions, Next Steps. Professional but accessible tone.",
    "field_survey": "You are writing a field survey report for a research team. Sections: Background, Methodology, Sample Description, Key Findings, Data Quality Assessment, Limitations, Recommendations. Technical but readable.",
    "research": "You are writing an academic research paper. Sections: Abstract, Introduction, Methods, Results, Discussion, Conclusion. Use formal academic language.",
    "government": "You are writing an official government administrative report. Sections: Executive Summary, Objectives, Methodology, Findings, Recommendations, Action Points. Formal bureaucratic style.",
    "ngo": "You are writing an NGO/donor impact report. Sections: Program Overview, Impact Summary, Key Indicators, Challenges, Lessons Learned. Warm but evidence-based tone.",
    "executive": "You are writing a concise executive summary for leadership. Maximum 2 pages. Focus on key numbers, decisions needed, and actionable next steps.",
}


class AIReportRequest(BaseModel):
    dataset_id: str
    tables_data: list = []
    style: str = "field_survey"
    custom_context: str = ""
    filename: str = ""


@app.post("/api/ai/report")
async def ai_generate_report(body: AIReportRequest):
    """Generate a full report from table data."""
    cfg = _load_ai_cfg()
    style_prompt = REPORT_STYLE_PROMPTS.get(body.style, REPORT_STYLE_PROMPTS["field_survey"])

    tables_text = ""
    for i, t in enumerate(body.tables_data[:10]):
        title = t.get("title", f"Table {i+1}")
        headers = t.get("headers", [])
        rows = t.get("rows", [])
        tables_text += f"\n### {title}\n"
        tables_text += " | ".join(str(h) for h in headers) + "\n"
        tables_text += " | ".join("---" for _ in headers) + "\n"
        for row in rows[:30]:
            tables_text += " | ".join(str(v) for v in row) + "\n"
        if len(rows) > 30:
            tables_text += f"... ({len(rows) - 30} more rows)\n"

    row_count = 0
    if body.dataset_id in datasets:
        row_count = len(datasets[body.dataset_id]["df"])

    prompt = (
        f"{style_prompt}\n\n"
        f"Dataset: {body.filename or 'Data Analysis'}\n"
        f"Total records: {row_count}\n"
        f"Number of tables analyzed: {len(body.tables_data)}\n\n"
        f"Tabulation data:\n{tables_text[:10000] if tables_text else 'No tabulation data — use placeholders.'}\n\n"
        f"Additional context: {body.custom_context or 'None.'}\n\n"
        f"Generate a complete, professional report in markdown. Use ## for sections, **bold** for key findings. "
        f"Be specific and data-driven. Mark sections needing human input with [REVIEW NEEDED]."
    )
    report = await _call_llm(cfg, prompt)
    return {"report": report}


# AI proxy to FieldGovern (when embedded)
@app.post("/api/ai/fg-proxy")
async def ai_fg_proxy(body: dict):
    """Proxy AI requests to FieldGovern backend when embedded."""
    import httpx
    fg_url = body.get("fg_url", "").rstrip("/")
    token = body.get("token", "")
    endpoint = body.get("endpoint", "")
    payload = body.get("payload", {})
    if not fg_url or not token or not endpoint:
        raise HTTPException(400, "Missing fg_url, token, or endpoint")
    internal_base = os.environ.get("FG_INTERNAL_URL", "").rstrip("/")
    base = internal_base if internal_base else fg_url
    url = f"{base}{endpoint}"
    try:
        async with httpx.AsyncClient(timeout=120.0, verify=bool(not internal_base)) as client:
            resp = await client.post(url, json=payload, headers={"Authorization": f"Bearer {token}"})
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"FG returned {resp.status_code}: {resp.text[:200]}")
        return resp.json()
    except httpx.RequestError as e:
        raise HTTPException(502, f"Could not reach FieldGovern: {e}")


# ═══════════════════════════════════════════════════
# Serve Frontend (production)
# ═══════════════════════════════════════════════════

STATIC_DIR = BASE_DIR / "static"
if STATIC_DIR.exists() and (STATIC_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(STATIC_DIR / "index.html")
