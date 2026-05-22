"""Project Save/Load — persistence, versioning, batch processing."""

import json
import uuid
from pathlib import Path
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
import pandas as pd

from ..shared import (datasets, custom_metrics, audit_logs, annotations,
                      column_roles, study_designs,
                      PROJECTS_DIR, CACHE_DIR, EXPORTS_DIR,
                      sanitize_for_json, add_audit_log, get_user_projects_dir, is_super_admin)

router = APIRouter()


class ProjectData(BaseModel):
    name: str
    config: dict
    password: Optional[str] = None


@router.post("/api/project/save")
async def save_project(project: ProjectData, x_user_id: Optional[str] = Header(None), x_user_role: Optional[str] = Header(None)):
    project_id = str(uuid.uuid4())
    safe_name = "".join(c for c in project.name if c.isalnum() or c in " _-").strip()
    if not safe_name:
        safe_name = "project"
    projects_dir = get_user_projects_dir(x_user_id)
    filepath = projects_dir / f"{safe_name}.tableforge"
    timestamp = datetime.now().isoformat()

    existing_versions = []
    if filepath.exists():
        try:
            existing_data = json.loads(filepath.read_text())
            existing_versions = existing_data.get("versions", [])
            existing_versions = existing_versions[-9:]
            if "meta" in existing_data:
                existing_versions.append({
                    "saved_at": existing_data["meta"].get("created", ""),
                    "tables": existing_data.get("tables", []),
                    "annotationsMap": existing_data.get("annotationsMap", {}),
                })
        except Exception:
            pass

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
    if "source_file" in project.config and isinstance(project.config["source_file"], dict):
        fe_sf = project.config["source_file"]
        if source_file:
            source_file = {**source_file, **{k: v for k, v in fe_sf.items() if v}}
        else:
            source_file = fe_sf

    # Survey-analysis metadata: pull from in-memory state if not already in config
    metadata_block = project.config.get("metadata") or {}
    if dataset_id:
        if "column_roles" not in metadata_block and dataset_id in column_roles:
            metadata_block["column_roles"] = column_roles[dataset_id]
        if "study_design" not in metadata_block and dataset_id in study_designs:
            metadata_block["study_design"] = study_designs[dataset_id]
    config_to_save = {**project.config}
    if metadata_block:
        config_to_save["metadata"] = metadata_block

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
        **config_to_save,
    }

    if project.password:
        import base64, hashlib
        raw = json.dumps(data).encode("utf-8")
        key = hashlib.sha256(project.password.encode()).digest()
        enc = bytes([b ^ key[i % len(key)] for i, b in enumerate(raw)])
        filepath.write_text(json.dumps({"encrypted": True, "data": base64.b64encode(enc).decode()}))
    else:
        filepath.write_text(json.dumps(data, indent=2))
    add_audit_log(project.config.get("dataset_id", ""), "project_save", f"Saved project: {project.name}")
    return {"project_id": project_id, "path": str(filepath)}


@router.get("/api/projects")
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
        scan_dir(PROJECTS_DIR)
        for user_dir in PROJECTS_DIR.iterdir():
            if user_dir.is_dir():
                scan_dir(user_dir)
    elif x_user_id:
        user_dir = get_user_projects_dir(x_user_id)
        scan_dir(user_dir)
    else:
        scan_dir(PROJECTS_DIR)

    return {"projects": sorted(projects, key=lambda p: p.get("created", ""), reverse=True), "projects_dir": str(PROJECTS_DIR)}


class ProjectRenameRequest(BaseModel):
    path: str
    new_name: str


@router.post("/api/project/rename")
async def rename_project(req: ProjectRenameRequest, x_user_id: Optional[str] = Header(None), x_user_role: Optional[str] = Header(None)):
    p = Path(req.path)
    if not p.exists():
        raise HTTPException(404, "Project not found")
    if x_user_id and not is_super_admin(x_user_role):
        user_dir = get_user_projects_dir(x_user_id)
        if not str(p.resolve()).startswith(str(user_dir.resolve())):
            raise HTTPException(403, "Access denied")

    safe_name = "".join(c for c in req.new_name if c.isalnum() or c in " _-").strip()
    if not safe_name:
        raise HTTPException(400, "Invalid name")

    data = json.loads(p.read_text())
    if data.get("encrypted"):
        raise HTTPException(400, "Cannot rename encrypted projects")

    data.setdefault("meta", {})["name"] = req.new_name
    new_path = p.parent / f"{safe_name}.tableforge"
    new_path.write_text(json.dumps(data, indent=2))
    if new_path != p:
        p.unlink()

    add_audit_log("", "project_rename", f"Renamed project to: {req.new_name}")
    return {"status": "ok", "new_path": str(new_path), "name": req.new_name}


class ProjectDeleteRequest(BaseModel):
    path: str


@router.post("/api/project/delete")
async def delete_project(req: ProjectDeleteRequest, x_user_id: Optional[str] = Header(None), x_user_role: Optional[str] = Header(None)):
    p = Path(req.path)
    if not p.exists():
        raise HTTPException(404, "Project not found")
    if x_user_id and not is_super_admin(x_user_role):
        user_dir = get_user_projects_dir(x_user_id)
        if not str(p.resolve()).startswith(str(user_dir.resolve())):
            raise HTTPException(403, "Access denied")

    name = p.stem
    p.unlink()
    add_audit_log("", "project_delete", f"Deleted project: {name}")
    return {"status": "ok"}


@router.get("/api/project/versions")
async def get_project_versions(path: str):
    p = Path(path)
    if not p.exists():
        raise HTTPException(404, "Project not found")
    data = json.loads(p.read_text())
    return {"versions": data.get("versions", [])}


def _snapshot_for_index(data: dict, idx: int) -> dict:
    """idx == -1 means current; otherwise an index into versions[]."""
    if idx == -1:
        return {"tables": data.get("tables", []), "saved_at": data.get("meta", {}).get("created", "")}
    versions = data.get("versions", [])
    if idx < 0 or idx >= len(versions):
        raise HTTPException(400, f"Invalid version index: {idx}")
    v = versions[idx]
    return {"tables": v.get("tables", []), "saved_at": v.get("saved_at", "")}


def _diff_tables(left: list, right: list) -> dict:
    """Return added/removed/changed tables between two snapshots (left=base, right=compare)."""
    by_id_l = {t.get("id"): t for t in left}
    by_id_r = {t.get("id"): t for t in right}
    added = [{"id": tid, "name": by_id_r[tid].get("title") or by_id_r[tid].get("name", tid)}
             for tid in by_id_r.keys() - by_id_l.keys()]
    removed = [{"id": tid, "name": by_id_l[tid].get("title") or by_id_l[tid].get("name", tid)}
               for tid in by_id_l.keys() - by_id_r.keys()]
    changed = []
    for tid in by_id_l.keys() & by_id_r.keys():
        l = by_id_l[tid]
        r = by_id_r[tid]
        field_changes = []
        for key in ("title", "subtitle", "name", "rows", "columns", "values", "filters", "header_renames",
                    "subtotals", "grand_total", "sort_by", "sort_order", "blank_suppress",
                    "conditional_formats", "pinned"):
            lv = l.get(key)
            rv = r.get(key)
            if lv != rv:
                field_changes.append({"field": key, "before": lv, "after": rv})
        if field_changes:
            changed.append({
                "id": tid,
                "name": r.get("title") or r.get("name", tid),
                "changes": field_changes,
            })
    return {"added": added, "removed": removed, "changed": changed,
            "summary": {"added": len(added), "removed": len(removed), "changed": len(changed),
                        "total_left": len(left), "total_right": len(right)}}


@router.get("/api/project/diff")
async def diff_project_versions(path: str, left: int = -1, right: int = -1):
    """Compare two versions of the same project.
    Indices into versions[]; use -1 for 'current'.
    """
    p = Path(path)
    if not p.exists():
        raise HTTPException(404, "Project not found")
    data = json.loads(p.read_text())
    if data.get("encrypted"):
        raise HTTPException(400, "Diff not supported on encrypted projects")
    snap_l = _snapshot_for_index(data, left)
    snap_r = _snapshot_for_index(data, right)
    diff = _diff_tables(snap_l["tables"], snap_r["tables"])
    return {
        "left": {"index": left, "saved_at": snap_l["saved_at"]},
        "right": {"index": right, "saved_at": snap_r["saved_at"]},
        **diff,
    }


class RollbackRequest(BaseModel):
    path: str
    version_index: int


@router.post("/api/project/rollback")
async def rollback_project(req: RollbackRequest):
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
    current_snapshot = {
        "saved_at": data.get("meta", {}).get("created", ""),
        "tables": data.get("tables", []),
        "annotationsMap": data.get("annotationsMap", {}),
    }
    all_versions = versions[:] + [current_snapshot]
    all_versions = all_versions[-10:]

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


@router.get("/api/project/load")
async def load_project(path: str, password: Optional[str] = None, x_user_id: Optional[str] = Header(None), x_user_role: Optional[str] = Header(None)):
    p = Path(path)
    if not p.exists():
        raise HTTPException(404, "Project file not found")
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


@router.post("/api/project/reload-file")
async def reload_project_file(body: dict):
    """Re-import the cached source file associated with a project."""
    cache_path = body.get("cache_path") or ""
    dataset_id_hint = body.get("dataset_id") or ""
    filename = body.get("filename") or "unknown"

    p = Path(cache_path) if cache_path else None
    if not p or not p.exists():
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
    file_paths: list[str]
    export_format: str = "xlsx"
    output_folder: str = ""


@router.post("/api/project/batch")
async def batch_process(config: BatchProcessConfig):
    """Apply a project template to multiple files and export each."""
    from .tabulate import TableConfig, tabulate
    from .export import ExportConfig, export_excel, export_word, export_pdf, export_csv

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
                src = EXPORTS_DIR / out.get("download_filename", "")
                if src.exists() and output_dir != EXPORTS_DIR:
                    import shutil
                    shutil.move(str(src), str(output_dir / src.name))
                results.append({"file": fp.name, "status": "ok", "output": out_filename})
            else:
                results.append({"file": fp.name, "status": "skipped", "message": "No fields matched"})

            del datasets[temp_id]
        except Exception as e:
            results.append({"file": fp.name, "status": "error", "message": str(e)})

    return {"results": results, "processed": len([r for r in results if r["status"] == "ok"])}
