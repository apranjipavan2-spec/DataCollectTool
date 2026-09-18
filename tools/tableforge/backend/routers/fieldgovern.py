"""FieldGovern integration — data import + proxy endpoints."""

import os
import json
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import pandas as pd

from ..shared import (datasets, custom_metrics, custom_bins, audit_logs, annotations,
                      column_type_overrides, CACHE_DIR, sanitize_for_json, add_audit_log, _is_multi_choice)

router = APIRouter()


async def _fetch_fg_column_labels(base: str, form_id: str, token: str, verify: bool) -> dict:
    """Best-effort name -> label map for display only (never used to rename df columns).

    Keyed by field `name` (not `id`) — submission/export data is keyed by name.
    Uses the form's current published schema; not necessarily the version
    active when older submissions were collected (acceptable simplification).
    """
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15.0, verify=verify) as client:
            resp = await client.get(f"{base}/api/v1/forms/{form_id}",
                                     headers={"Authorization": f"Bearer {token}"})
        if resp.status_code != 200:
            return {}
        schema = (resp.json() or {}).get("json_schema") or {}
        labels = {}
        for section in schema.get("sections", []):
            for f in section.get("fields", []):
                fname = f.get("name", "")
                if fname:
                    labels[fname] = f.get("label", fname)
        return labels
    except Exception:
        return {}


async def _fetch_fg_program_column_labels(base: str, program_id: str, token: str, verify: bool) -> dict:
    """Merged name -> label map across every form linked to a program.

    A program can span multiple questionnaires/forms; merge each form's
    labels the same way the single-form path does, so program-based loads
    get the same header labels as form-first loads.
    """
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15.0, verify=verify) as client:
            resp = await client.get(f"{base}/api/v1/programs/{program_id}/questionnaires",
                                     headers={"Authorization": f"Bearer {token}"})
        if resp.status_code != 200:
            return {}
        form_ids = {q["form_id"] for q in (resp.json() or []) if q.get("form_id")}
        merged: dict = {}
        for fid in form_ids:
            merged.update(await _fetch_fg_column_labels(base, fid, token, verify))
        return merged
    except Exception:
        return {}


class FGImportBody(BaseModel):
    fg_base_url: str
    token: str
    program_id: Optional[str] = None
    questionnaire_id: Optional[str] = None
    form_id: Optional[str] = None  # form-first import: pull one form's responses directly


@router.post("/api/import-from-fg")
async def import_from_fg(body: FGImportBody):
    """Fetch program submissions from FieldGovern and load as a dataset via SSE."""
    import httpx

    async def progress_stream():
        try:
            yield f"data: {json.dumps({'step': 'connecting', 'message': 'Connecting to FieldGovern…', 'percent': 5})}\n\n"

            internal_base = os.environ.get("FG_INTERNAL_URL", "").rstrip("/")
            base = internal_base if internal_base else body.fg_base_url.rstrip("/")
            if body.form_id:
                # Form-first import: pull a single form's submissions directly,
                # no program membership required. decode_values=true so choice-field
                # cells show option labels (e.g. "Male") instead of raw codes ("1") —
                # headers stay as field codes, matching the separate label map below.
                url = f"{base}/api/v1/export/{body.form_id}/xlsx?decode_values=true"
            elif body.program_id:
                url = f"{base}/api/v1/fg/programs/{body.program_id}/export.xlsx?decode_values=true"
                if body.questionnaire_id:
                    url += f"&questionnaire_id={body.questionnaire_id}"
            else:
                yield f"data: {json.dumps({'step': 'error', 'message': 'No form or program specified', 'percent': 0})}\n\n"
                return

            yield f"data: {json.dumps({'step': 'downloading', 'message': 'Downloading data from server…', 'percent': 15})}\n\n"

            async with httpx.AsyncClient(timeout=120.0, verify=bool(not internal_base)) as client:
                resp = await client.get(url, headers={"Authorization": f"Bearer {body.token}"})

            if resp.status_code != 200:
                yield f"data: {json.dumps({'step': 'error', 'message': f'FieldGovern returned {resp.status_code}', 'percent': 0})}\n\n"
                return

            file_size = len(resp.content)
            yield f"data: {json.dumps({'step': 'saving', 'message': f'Downloaded {file_size // 1024} KB — saving…', 'percent': 40})}\n\n"

            dataset_id = str(uuid.uuid4())
            source_id = body.form_id or body.program_id
            filename = f"fg_{'form' if body.form_id else 'program'}_{source_id}.xlsx"
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

            # Display-only name->label map
            column_labels = {}
            if body.form_id:
                column_labels = await _fetch_fg_column_labels(base, body.form_id, body.token, bool(not internal_base))
            elif body.program_id:
                column_labels = await _fetch_fg_program_column_labels(base, body.program_id, body.token, bool(not internal_base))

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
                col_entry = {
                    "name": col,
                    "type": col_type,
                    "sample_values": [str(v) for v in sample_values],
                    "stats": sanitize_for_json(stats),
                }
                if col in column_labels:
                    col_entry["label"] = column_labels[col]
                columns.append(col_entry)

            pct = 70 + int((i + 1) / col_count * 20) if col_count > 0 else 90
            yield f"data: {json.dumps({'step': 'finalizing', 'message': f'Building dataset ({row_count} rows, {col_count} columns)…', 'percent': 92})}\n\n"

            datasets[dataset_id] = {"df": df, "filename": filename, "sheets": xls.sheet_names}
            custom_metrics[dataset_id] = []
            custom_bins[dataset_id] = []
            audit_logs[dataset_id] = []
            annotations[dataset_id] = {}
            column_type_overrides[dataset_id] = {}
            add_audit_log(dataset_id, "fg_import", f"Imported from FieldGovern {'form' if body.form_id else 'program'} {source_id}: {row_count} rows")
            datasets.persist(dataset_id)

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


# ── FG Proxy Endpoints ──

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
    internal = os.environ.get("FG_INTERNAL_URL", "").rstrip("/")
    if internal:
        return internal, False
    return external_url.rstrip("/"), True


@router.post("/api/fg/programs")
async def proxy_fg_programs(body: FGBaseBody):
    import httpx
    base, verify = _fg_base(body.fg_base_url)
    url = f"{base}/api/v1/programs/"
    async with httpx.AsyncClient(timeout=30, verify=verify) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {body.token}"})
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "FieldGovern programs fetch failed")
    return resp.json()


@router.post("/api/fg/forms")
async def proxy_fg_forms(body: FGBaseBody):
    """List all of the tenant's forms (program membership not required)."""
    import httpx
    base, verify = _fg_base(body.fg_base_url)
    url = f"{base}/api/v1/forms/"
    async with httpx.AsyncClient(timeout=30, verify=verify) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {body.token}"})
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "FieldGovern forms fetch failed")
    return resp.json()


@router.post("/api/fg/questionnaires")
async def proxy_fg_questionnaires(body: FGQuestionnairesBody):
    import httpx
    base, verify = _fg_base(body.fg_base_url)
    url = f"{base}/api/v1/programs/{body.program_id}/questionnaires"
    async with httpx.AsyncClient(timeout=30, verify=verify) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {body.token}"})
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "FieldGovern questionnaires fetch failed")
    return resp.json()


@router.post("/api/fg/user-projects/save")
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


class FGListBody(BaseModel):
    fg_base_url: str
    token: str
    tool: str = "analyzer"
    archived: bool = False


class FGProjectActionBody(BaseModel):
    fg_base_url: str
    token: str
    project_id: str


@router.post("/api/fg/user-projects/list")
async def proxy_list_fg_projects(body: FGListBody):
    import httpx
    base, verify = _fg_base(body.fg_base_url)
    url = f"{base}/api/v1/tool-projects/?tool={body.tool}&archived={'true' if body.archived else 'false'}"
    async with httpx.AsyncClient(timeout=30, verify=verify) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {body.token}"})
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Failed to list projects from FieldGovern")
    return resp.json()


@router.post("/api/fg/user-projects/archive")
async def proxy_archive_fg_project(body: FGProjectActionBody):
    import httpx
    base, verify = _fg_base(body.fg_base_url)
    url = f"{base}/api/v1/tool-projects/{body.project_id}"
    async with httpx.AsyncClient(timeout=30, verify=verify) as client:
        resp = await client.delete(url, headers={"Authorization": f"Bearer {body.token}"})
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Failed to archive project in FieldGovern")
    return resp.json()


@router.post("/api/fg/user-projects/restore")
async def proxy_restore_fg_project(body: FGProjectActionBody):
    import httpx
    base, verify = _fg_base(body.fg_base_url)
    url = f"{base}/api/v1/tool-projects/{body.project_id}/restore"
    async with httpx.AsyncClient(timeout=30, verify=verify) as client:
        resp = await client.post(url, headers={"Authorization": f"Bearer {body.token}"})
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Failed to restore project in FieldGovern")
    return resp.json()
