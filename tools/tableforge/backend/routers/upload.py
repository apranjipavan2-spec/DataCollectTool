"""Module A: File Upload & Data Ingestion router."""

import uuid
from typing import Optional

import pandas as pd
import numpy as np
from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from pydantic import BaseModel

from ..shared import (
    datasets,
    custom_metrics,
    custom_bins,
    audit_logs,
    annotations,
    column_type_overrides,
    upload_progress,
    CACHE_DIR,
    PARQUET_DIR,
    LARGE_FILE_THRESHOLD,
    sanitize_for_json,
    add_audit_log,
    _is_multi_choice,
    _detect_columns,
)

router = APIRouter()


# ═══════════════════════════════════════════════════
# Module A: File Upload & Data Ingestion
# ═══════════════════════════════════════════════════

@router.post("/api/upload")
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

@router.post("/api/upload/sheet")
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


# ─── Column Rename / Exclude ───

class ColumnOps(BaseModel):
    dataset_id: str
    renames: dict = {}          # {"old_name": "new_name"}
    exclude_columns: list[str] = []
    exclude_rows: list[int] = []  # row indices to exclude
    header_row: Optional[int] = None  # manual header row override

@router.post("/api/dataset/modify")
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

@router.post("/api/dataset/column_type")
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

@router.post("/api/upload/union")
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

@router.post("/api/dataset/{dataset_id}/refresh")
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
