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
    _strip_formula_cells,
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
            _eng = "openpyxl" if ext == "xlsx" else "xlrd"
            # engine_kwargs only on pd.read_excel(), not pd.ExcelFile().
            # xlrd (for .xls) doesn't support data_only — xlsx only.
            _ekw = {"data_only": True} if ext == "xlsx" else {}
            xls = pd.ExcelFile(tmp_path, engine=_eng)
            sheets = xls.sheet_names
            df = pd.read_excel(tmp_path, sheet_name=sheets[0],
                               engine=_eng, engine_kwargs=_ekw)
            # Strip formula strings that slipped through (no cached value in workbook).
            _strip_formula_cells(df)
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

    # Detect column types (modifies df in-place for numeric coercion)
    columns = _detect_columns(df)

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
    _eng2 = "openpyxl" if ext == "xlsx" else "xlrd"
    _ekw2 = {"data_only": True} if ext == "xlsx" else {}
    df = pd.read_excel(tmp_path, sheet_name=req.sheet_name,
                       engine=_eng2, engine_kwargs=_ekw2)
    _strip_formula_cells(df)
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
            _eng = "openpyxl" if ext == "xlsx" else "xlrd"
            _ekw = {"data_only": True} if ext == "xlsx" else {}
            df = pd.read_excel(tmp_path, header=ops.header_row,
                               engine=_eng, engine_kwargs=_ekw)
            _strip_formula_cells(df)
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
    new_type: str  # "text", "numeric", "multi_choice", "date", "boolean"
    dry_run: bool | None = False

@router.post("/api/dataset/column_type")
async def set_column_type(req: ColumnTypeReq):
    """Override the detected data type for a specific column.
    When dry_run=true, runs the parse but does NOT mutate state; returns counts.
    """
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[req.dataset_id]["df"]
    if req.column not in df.columns:
        raise HTTPException(404, f"Column '{req.column}' not found")

    # Dry-run path: don't mutate state, just compute parse-failure counts
    if req.dry_run:
        src = df[req.column]
        total = int(src.shape[0])
        non_null = int(src.notna().sum())

        # Pick "context columns" so the user can identify which row each failure belongs to.
        # Prefer columns whose name suggests an identifier; fall back to the first 3 non-target columns.
        id_keywords = ("id", "name", "respondent", "sl", "serial", "code", "uid", "uuid", "phone", "mobile", "district", "village", "block", "tehsil", "state", "ward", "house")
        cols_lower = [(c, str(c).lower()) for c in df.columns if c != req.column]
        id_cols = [c for c, lc in cols_lower if any(kw in lc for kw in id_keywords)]
        # Cap to first 4 id-like columns; if none found, take the first 3 columns of the dataset (excluding target)
        if id_cols:
            context_cols = id_cols[:4]
        else:
            context_cols = [c for c in df.columns if c != req.column][:3]

        def _build_response(parsed):
            fail_mask = parsed.isna() & src.notna()
            fail_count = int(fail_mask.sum())
            samples = [str(v) for v in src[fail_mask].head(5).tolist()]
            # Per-cell failures: row index (0-based) + raw value + context columns from the same row, capped at 200
            failing_subset = src[fail_mask].head(200)
            failing_cells = []
            for idx, val in failing_subset.items():
                context = {}
                for cc in context_cols:
                    try:
                        cv = df.at[idx, cc]
                        # Stringify, treat NaN as empty
                        if pd.isna(cv):
                            context[str(cc)] = ""
                        else:
                            context[str(cc)] = str(cv)
                    except Exception:
                        context[str(cc)] = ""
                failing_cells.append({"row": int(idx), "value": str(val), "context": context})
            return {"dry_run": True, "column": req.column, "new_type": req.new_type,
                    "total": total, "non_null": non_null,
                    "fail_count": fail_count, "samples": samples,
                    "failing_cells": failing_cells,
                    "context_columns": [str(c) for c in context_cols]}

        if req.new_type == "numeric":
            parsed = pd.to_numeric(src, errors="coerce")
            return _build_response(parsed)
        elif req.new_type == "date":
            parsed = pd.to_datetime(src, errors="coerce")
            return _build_response(parsed)
        else:
            return {"dry_run": True, "column": req.column, "new_type": req.new_type,
                    "total": total, "non_null": non_null, "fail_count": 0,
                    "samples": [], "failing_cells": []}

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
                        _eng = "openpyxl" if ext == "xlsx" else "xlrd"
                        _ekw = {"data_only": True} if ext == "xlsx" else {}
                        raw_df = pd.read_excel(cache_path, dtype={req.column: str},
                                               engine=_eng, engine_kwargs=_ekw)
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
    elif req.new_type == "boolean":
        truthy = {'true', 'yes', 'y', 't', '1'}
        falsy = {'false', 'no', 'n', 'f', '0'}
        def _to_bool(v):
            if pd.isna(v):
                return None
            s = str(v).strip().lower()
            if s in truthy:
                return True
            if s in falsy:
                return False
            return None
        datasets[req.dataset_id]["df"][req.column] = df[req.column].apply(_to_bool).astype("boolean")

    add_audit_log(req.dataset_id, "column_type_change", f"Changed '{req.column}' to {req.new_type}")
    return {"status": "ok", "column": req.column, "new_type": req.new_type}


@router.get("/api/dataset/{dataset_id}/anomalies")
async def detect_anomalies(dataset_id: str, method: str = "zscore", threshold: float = 3.0):
    """Detect outlier cells per numeric column using z-score or MAD.
    Returns {column: {indices: [...], values: [...], count, total}} for each numeric column.
    method: 'zscore' or 'mad'. threshold: z >= threshold (or MAD-equivalent).
    """
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[dataset_id]["df"]
    per_col = {}
    for col in df.columns:
        s = df[col]
        # Only numeric
        if not pd.api.types.is_numeric_dtype(s):
            continue
        non_null = s.dropna()
        if len(non_null) < 5:
            continue
        if method == "mad":
            med = float(non_null.median())
            mad = float((non_null - med).abs().median()) or 1e-9
            scores = (s - med).abs() / (1.4826 * mad)
        else:
            mean = float(non_null.mean())
            std = float(non_null.std()) or 1e-9
            scores = (s - mean).abs() / std
        outlier_mask = scores >= threshold
        outlier_idx = [int(i) for i in s.index[outlier_mask.fillna(False)].tolist()]
        outlier_vals = [float(v) if pd.notna(v) else None for v in s[outlier_mask.fillna(False)].tolist()]
        outlier_scores = [round(float(z), 2) if pd.notna(z) else None for z in scores[outlier_mask.fillna(False)].tolist()]
        if outlier_idx:
            per_col[col] = {
                "indices": outlier_idx[:500],  # cap response size
                "values": outlier_vals[:500],
                "scores": outlier_scores[:500],
                "count": len(outlier_idx),
                "total": int(len(non_null)),
                "method": method,
                "threshold": threshold,
            }
    return {"columns": per_col, "method": method, "threshold": threshold}


@router.get("/api/dataset/{dataset_id}/type_hints")
async def column_type_hints(dataset_id: str):
    """Detect text columns whose values are mostly numeric or date — suggest a one-click convert.
    Returns hints with suggested_type, parse_success_rate, and sample failing rows.
    """
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    df = datasets[dataset_id]["df"]
    overrides = column_type_overrides.get(dataset_id, {})
    hints = []
    for col in df.columns:
        if overrides.get(col):  # user already chose a type; respect it
            continue
        src = df[col]
        if not (src.dtype == object or str(src.dtype).startswith("string")):
            continue
        non_null = src.dropna()
        if len(non_null) == 0 or len(non_null) < 5:
            continue
        # Try numeric
        as_num = pd.to_numeric(non_null, errors="coerce")
        num_rate = (as_num.notna().sum() / len(non_null)) if len(non_null) else 0
        # Try date
        try:
            as_date = pd.to_datetime(non_null, errors="coerce")
            date_rate = (as_date.notna().sum() / len(non_null)) if len(non_null) else 0
        except Exception:
            date_rate = 0
        # Pick highest plausible suggestion
        if num_rate >= 0.85 and num_rate > date_rate:
            fail_mask = as_num.isna()
            samples = [str(v) for v in non_null[fail_mask].head(5).tolist()]
            hints.append({"column": col, "suggested_type": "numeric",
                          "success_rate": round(float(num_rate), 3),
                          "fail_count": int(fail_mask.sum()),
                          "samples": samples})
        elif date_rate >= 0.85 and date_rate > num_rate:
            fail_mask = as_date.isna()
            samples = [str(v) for v in non_null[fail_mask].head(5).tolist()]
            hints.append({"column": col, "suggested_type": "date",
                          "success_rate": round(float(date_rate), 3),
                          "fail_count": int(fail_mask.sum()),
                          "samples": samples})
    return {"hints": hints}


# ─── Multi-Sheet Union ───

class UnionConfig(BaseModel):
    dataset_id: str
    sheet_names: list[str]
    mode: str | None = "concat"  # "concat" | "join_inner" | "join_outer"
    join_on: list[str] | None = None  # if None and mode is join_*, auto-detect common columns

@router.post("/api/upload/union")
async def union_sheets(config: UnionConfig):
    """Combine multiple sheets into one dataset.
    Modes:
      - concat (default): stack rows; missing columns become NaN
      - join_inner: inner-merge on join_on (auto-detected common cols if None)
      - join_outer: outer-merge on join_on
    """
    if config.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    ext = datasets[config.dataset_id]["filename"].rsplit(".", 1)[-1].lower()
    tmp_path = CACHE_DIR / f"{config.dataset_id}.{ext}"
    _eng = "openpyxl" if ext == "xlsx" else "xlrd"
    _ekw = {"data_only": True} if ext == "xlsx" else {}
    frames = []
    used_sheets = []
    for sheet in config.sheet_names:
        try:
            _f = pd.read_excel(tmp_path, sheet_name=sheet, engine=_eng, engine_kwargs=_ekw)
            _strip_formula_cells(_f)
            frames.append(_f)
            used_sheets.append(sheet)
        except Exception:
            pass
    if not frames:
        raise HTTPException(400, "No valid sheets to union")

    mode = (config.mode or "concat").lower()
    if mode in ("join_inner", "join_outer") and len(frames) >= 2:
        # Auto-detect common columns if not provided
        common = set(frames[0].columns)
        for f in frames[1:]:
            common &= set(f.columns)
        keys = config.join_on or sorted(common)
        if not keys:
            raise HTTPException(400, "No common columns found for join; use concat or specify join_on")
        how = "inner" if mode == "join_inner" else "outer"
        df = frames[0]
        for f in frames[1:]:
            df = df.merge(f, on=keys, how=how, suffixes=("", "_dup"))
        join_desc = f"{mode} on [{', '.join(keys)}]"
    else:
        df = pd.concat(frames, ignore_index=True)
        join_desc = "concat"
    datasets[config.dataset_id]["df"] = df
    add_audit_log(config.dataset_id, "sheet_union",
                  f"Combined {len(used_sheets)} sheet(s) via {join_desc}: {', '.join(used_sheets)}")
    columns = _detect_columns(df)
    return {"row_count": len(df), "columns": columns,
            "preview": sanitize_for_json(df.head(50).fillna("").to_dict(orient="records"))}


class SheetsInfoRequest(BaseModel):
    dataset_id: str
    sheet_names: list[str]

@router.post("/api/upload/sheets_info")
async def sheets_info(req: SheetsInfoRequest):
    """Return per-sheet column lists + auto-detected common (join-eligible) columns.
    Used by frontend to suggest auto-join keys before calling /api/upload/union.
    """
    if req.dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    ext = datasets[req.dataset_id]["filename"].rsplit(".", 1)[-1].lower()
    tmp_path = CACHE_DIR / f"{req.dataset_id}.{ext}"
    _eng = "openpyxl" if ext == "xlsx" else "xlrd"
    _ekw = {"data_only": True} if ext == "xlsx" else {}
    per_sheet = {}
    col_sets = []
    for sheet in req.sheet_names:
        try:
            df_head = pd.read_excel(tmp_path, sheet_name=sheet, nrows=5,
                                    engine=_eng, engine_kwargs=_ekw)
            cols = list(df_head.columns)
            per_sheet[sheet] = cols
            col_sets.append(set(cols))
        except Exception:
            per_sheet[sheet] = []
    common = set()
    if col_sets:
        common = set.intersection(*col_sets) if len(col_sets) > 1 else col_sets[0]
    return {"per_sheet": per_sheet, "common_columns": sorted(common)}


# ─── Data Refresh ───

@router.post("/api/dataset/{dataset_id}/refresh")
async def refresh_dataset(dataset_id: str):
    """Reload the source file without losing configuration.
    If loaded from a server file, re-copies from uploads/ to get the latest version.
    """
    if dataset_id not in datasets:
        raise HTTPException(404, "Dataset not found")
    filename = datasets[dataset_id]["filename"]
    ext = filename.rsplit(".", 1)[-1].lower()
    tmp_path = CACHE_DIR / f"{dataset_id}.{ext}"

    server_file_id = datasets[dataset_id].get("server_file_id")
    if server_file_id:
        import shutil
        from .files import UPLOADS_DIR, _load_manifest
        manifest = _load_manifest()
        entry = next((f for f in manifest if f["id"] == server_file_id), None)
        if entry:
            src = UPLOADS_DIR / entry["stored_name"]
            if src.exists():
                shutil.copy2(str(src), str(tmp_path))

    if not tmp_path.exists():
        raise HTTPException(404, "Source file no longer cached")
    try:
        if ext in ("xlsx", "xls"):
            _eng = "openpyxl" if ext == "xlsx" else "xlrd"
            _ekw = {"data_only": True} if ext == "xlsx" else {}
            df = pd.read_excel(tmp_path, engine=_eng, engine_kwargs=_ekw)
            _strip_formula_cells(df)
        else:
            df = pd.read_csv(tmp_path)
        datasets[dataset_id]["df"] = df
        add_audit_log(dataset_id, "data_refresh", f"Reloaded {filename}" + (" (from server)" if server_file_id else ""))
        columns = _detect_columns(df)
        return {"row_count": len(df), "columns": columns}
    except Exception as e:
        raise HTTPException(400, f"Refresh failed: {str(e)}")
