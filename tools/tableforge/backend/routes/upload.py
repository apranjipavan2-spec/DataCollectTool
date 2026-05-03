"""File upload, sheet selection, column type override, and data refresh endpoints."""

import os
import uuid
from typing import Optional

from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from pydantic import BaseModel

from ..state import (
    datasets, custom_metrics, custom_bins, audit_logs, column_type_overrides,
    PROJECTS_DIR, EXPORTS_DIR, CACHE_DIR,
    add_audit_log, _is_multi_choice, _detect_columns,
)
from ..utils import sanitize_for_json, traceback_print_exc

router = APIRouter()

# ─── Pydantic Models ─────────────────────────────────────────────

class SheetSelect(BaseModel):
    dataset_id: str
    sheet_name: str


class ColumnOps(BaseModel):
    dataset_id: str
    renames: dict = {}          # {"old_name": "new_name"}
    exclude_columns: list[str] = []
    exclude_rows: list[int] = []
    header_row: Optional[int] = None  # manual header row override


class ColumnTypeReq(BaseModel):
    dataset_id: str
    column: str
    new_type: str  # "text", "numeric", "multi_choice", "date"


# ─── File Upload Endpoint ─────────────────────────────────────────

@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload an Excel or CSV file and return dataset metadata."""
    dataset_id = str(uuid.uuid4())
    filename = file.filename or "unknown"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    tmp_path = CACHE_DIR / f"{dataset_id}.{ext}"
    content = await file.read()
    tmp_path.write_bytes(content)

    file_size = len(content)
    is_large_file = file_size > 50 * 1024 * 1024  # 50 MB

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
        traceback_print_exc()
        raise HTTPException(400, f"Failed to read file: {str(e)}")

    # Cache large DataFrames as parquet for fast re-reads
    if is_large_file:
        try:
            parquet_path = CACHE_DIR.parent / "parquet_cache" / f"{dataset_id}.parquet"
            df.to_parquet(parquet_path, index=False)
        except Exception:
            pass  # parquet cache is optional

    # Detect column types
    columns = _detect_columns(df)

    datasets[dataset_id] = {
        "df": df,
        "filename": filename,
        "sheets": sheets if ext in ("xlsx", "xls") else [filename],
    }
    custom_metrics[dataset_id] = []
    custom_bins[dataset_id] = []
    audit_logs[dataset_id] = []
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


# ─── Sheet Selection Endpoint ────────────────────────────────────────

@router.post("/upload/sheet")
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


# ─── Column Rename / Exclude Endpoint ───────────────────────────────

@router.post("/dataset/modify")
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
    if ops.renames:
        details.append(f"Renamed {len(ops.renames)} columns")
    if ops.exclude_columns:
        details.append(f"Excluded {len(ops.exclude_columns)} columns")
    if ops.exclude_rows:
        details.append(f"Excluded {len(ops.exclude_rows)} rows")
    add_audit_log(ops.dataset_id, "data_modify", "; ".join(details))

    columns = _detect_columns(df)
    return {"row_count": len(df), "columns": columns,
            "preview": sanitize_for_json(df.head(50).fillna("").to_dict(orient="records"))}


# ─── Column Type Override Endpoint ──────────────────────────────────

@router.post("/dataset/column_type")
async def set_column_type(req: ColumnTypeReq):
    """Override the detected data type for a specific column."""
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[req.dataset_id]["df"]

    if req.column not in df.columns:
        raise HTTPException(400, f"Column '{req.column}' not found")

    current_dtype = str(df[req.column].dtype)

    if req.dataset_id not in column_type_overrides:
        column_type_overrides[req.dataset_id] = {}

    column_type_overrides[req.dataset_id][req.column] = req.new_type

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

    add_audit_log(req.dataset_id, "column_type_change", f"Changed '{req.column}' to {req.new_type}")

    return {"status": "ok", "column": req.column, "new_type": req.new_type}
