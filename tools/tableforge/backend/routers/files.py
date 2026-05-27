"""Server-side file manager — persistent uploads shared across sessions and tools."""

import os
import uuid
import json
from pathlib import Path
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File

from ..shared import BASE_DIR

router = APIRouter()

UPLOADS_DIR = BASE_DIR / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

MANIFEST_FILE = UPLOADS_DIR / "_manifest.json"


def _load_manifest() -> list:
    if MANIFEST_FILE.exists():
        try:
            return json.loads(MANIFEST_FILE.read_text())
        except Exception:
            pass
    return []


def _save_manifest(entries: list):
    MANIFEST_FILE.write_text(json.dumps(entries, indent=2))


@router.post("/api/files/upload")
async def upload_to_server(file: UploadFile = File(...)):
    """Upload a file to persistent server storage."""
    filename = file.filename or "unknown"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("xlsx", "xls", "csv", "tsv"):
        raise HTTPException(400, f"Unsupported file type: .{ext}")

    file_id = str(uuid.uuid4())[:8]
    safe_name = "".join(c for c in filename.rsplit(".", 1)[0] if c.isalnum() or c in " _-").strip()
    stored_name = f"{safe_name}_{file_id}.{ext}"
    dest = UPLOADS_DIR / stored_name

    content = await file.read()
    dest.write_bytes(content)

    entry = {
        "id": file_id,
        "original_name": filename,
        "stored_name": stored_name,
        "size_bytes": len(content),
        "size_mb": round(len(content) / 1024 / 1024, 2),
        "uploaded_at": datetime.now().isoformat(),
        "ext": ext,
    }

    manifest = _load_manifest()
    manifest.append(entry)
    _save_manifest(manifest)

    return {"message": f"File '{filename}' saved to server", "file": entry}


@router.get("/api/files")
async def list_server_files():
    """List all files stored on the server."""
    manifest = _load_manifest()
    # Verify files still exist on disk
    valid = []
    for entry in manifest:
        path = UPLOADS_DIR / entry["stored_name"]
        if path.exists():
            valid.append(entry)
    if len(valid) != len(manifest):
        _save_manifest(valid)
    return {"files": sorted(valid, key=lambda f: f.get("uploaded_at", ""), reverse=True)}


@router.delete("/api/files/{file_id}")
async def delete_server_file(file_id: str):
    """Delete a file from server storage."""
    manifest = _load_manifest()
    entry = next((f for f in manifest if f["id"] == file_id), None)
    if not entry:
        raise HTTPException(404, "File not found")
    path = UPLOADS_DIR / entry["stored_name"]
    if path.exists():
        path.unlink()
    manifest = [f for f in manifest if f["id"] != file_id]
    _save_manifest(manifest)
    return {"message": f"File '{entry['original_name']}' deleted"}


@router.post("/api/files/{file_id}/load")
async def load_server_file(file_id: str):
    """Load a server-stored file into memory as a dataset (same as upload but from server)."""
    import pandas as pd
    from ..shared import (datasets, custom_metrics, custom_bins, audit_logs,
                          annotations, column_type_overrides, CACHE_DIR,
                          sanitize_for_json, add_audit_log, _is_multi_choice,
                          _detect_columns, _strip_formula_cells)

    manifest = _load_manifest()
    entry = next((f for f in manifest if f["id"] == file_id), None)
    if not entry:
        raise HTTPException(404, "File not found on server")

    src_path = UPLOADS_DIR / entry["stored_name"]
    if not src_path.exists():
        raise HTTPException(404, "File missing from disk")

    ext = entry["ext"]
    dataset_id = str(uuid.uuid4())
    filename = entry["original_name"]

    # Copy to cache for consistency with normal upload flow
    cache_path = CACHE_DIR / f"{dataset_id}.{ext}"
    import shutil
    shutil.copy2(str(src_path), str(cache_path))

    try:
        if ext in ("xlsx", "xls"):
            _eng = "openpyxl" if ext == "xlsx" else "xlrd"
            _ekw = {"data_only": True} if ext == "xlsx" else {}
            xls = pd.ExcelFile(cache_path, engine=_eng)
            sheets = xls.sheet_names
            df = pd.read_excel(cache_path, sheet_name=sheets[0],
                               engine=_eng, engine_kwargs=_ekw)
            _strip_formula_cells(df)
        elif ext in ("csv", "tsv"):
            sep = "\t" if ext == "tsv" else ","
            df = None
            for enc in ["utf-8", "latin-1", "cp1252", "iso-8859-1"]:
                try:
                    df = pd.read_csv(cache_path, sep=sep, encoding=enc)
                    break
                except UnicodeDecodeError:
                    continue
            if df is None:
                df = pd.read_csv(cache_path, sep=sep, encoding="utf-8", errors="replace")
            sheets = [filename]
        else:
            raise HTTPException(400, f"Unsupported format: .{ext}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Failed to read file: {str(e)}")

    # Detect column types (modifies df in-place for numeric coercion)
    columns = _detect_columns(df)

    datasets[dataset_id] = {"df": df, "filename": filename, "sheets": sheets, "server_file_id": file_id}
    custom_metrics[dataset_id] = []
    custom_bins[dataset_id] = []
    audit_logs[dataset_id] = []
    annotations[dataset_id] = {}
    column_type_overrides[dataset_id] = {}
    add_audit_log(dataset_id, "server_file_load", f"Loaded '{filename}' from server storage")

    return {
        "dataset_id": dataset_id,
        "filename": filename,
        "sheets": sheets,
        "row_count": len(df),
        "columns": columns,
        "preview": sanitize_for_json(df.head(50).fillna("").to_dict(orient="records")),
    }
