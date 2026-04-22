"""
Migration API — import forms and submissions from XLSForm, Kobo, SurveyCTO, ODK Central.

All endpoints require org_admin role.
"""
from __future__ import annotations

import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_org_admin
from app.models.form import Form
from app.models.submission import Submission
from app.models.tenant import Tenant
from app.services.whatsapp import notify as wa_notify
from app.services.sheets_sync import bulk_sync_submissions

from .xlsform_parser import parse_xlsform
from .platform_clients import (
    KoboClient, SurveyCTOClient, ODKCentralClient, map_submission_data,
)

router = APIRouter()

_MAX_FILE = 20 * 1024 * 1024  # 20 MB


# ── helpers ────────────────────────────────────────────────────────────────────

def _extract_field_names(sections: list[dict]) -> set[str]:
    names: set[str] = set()
    for sec in sections:
        for f in sec.get("fields", []):
            if f.get("name"):
                names.add(f["name"])
            # repeat_group children
            for child in f.get("fields", []):
                if child.get("name"):
                    names.add(child["name"])
    return names


def _post_import_hooks(db: Session, tenant_id: str, form: Form, platform: str, submissions_imported: int, saved_rows: list[dict]) -> None:
    """Fire WhatsApp notification + Sheets sync after any platform import. Never raises."""
    try:
        tenant = db.query(Tenant).filter(Tenant.id == uuid.UUID(tenant_id)).first()
        if tenant:
            wa_notify(tenant, "import.complete", {
                "platform": platform,
                "form_count": 1,
                "submission_count": submissions_imported,
            })
    except Exception:
        pass
    try:
        if saved_rows:
            bulk_sync_submissions(form, saved_rows)
    except Exception:
        pass


def _save_form(db: Session, tenant_id: str, title: str, json_schema: dict) -> Form:
    form = Form(
        id=uuid.uuid4(),
        tenant_id=uuid.UUID(tenant_id),
        title=title,
        json_schema=json_schema,
        status="draft",
        version=1,
    )
    db.add(form)
    db.commit()
    db.refresh(form)
    return form


def _save_submissions(
    db: Session,
    form: Form,
    user,
    raw_submissions: list[dict],
    field_names: set[str],
) -> tuple[int, list[dict]]:
    """Returns (count_saved, list_of_data_jsons) for downstream Sheets sync."""
    saved = 0
    data_rows: list[dict] = []
    for raw in raw_submissions:
        data = map_submission_data(raw, field_names)
        sub = Submission(
            id=uuid.uuid4(),
            tenant_id=form.tenant_id,
            form_id=form.id,
            form_version=form.version,
            data_json=data,
            status="synced",
            enumerator_id=user.id,
            local_id=str(uuid.uuid4()),
        )
        db.add(sub)
        data_rows.append(data)
        saved += 1
    if saved:
        db.commit()
    return saved, data_rows


# ── XLSForm ────────────────────────────────────────────────────────────────────

@router.post("/xlsform/parse")
async def xlsform_parse(
    file: UploadFile = File(...),
    user=Depends(require_org_admin),
):
    """Upload an XLSForm .xlsx file — returns parsed schema preview + warnings."""
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only .xlsx / .xls files accepted")
    content = await file.read()
    if len(content) > _MAX_FILE:
        raise HTTPException(413, "File too large (max 20 MB)")
    try:
        result = parse_xlsform(content, filename=file.filename)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(422, f"Could not parse XLSForm: {e}")
    return result


class XLSFormSaveRequest(BaseModel):
    title: str
    json_schema: dict[str, Any]


@router.post("/xlsform/save")
def xlsform_save(
    body: XLSFormSaveRequest,
    user=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    """Save a parsed XLSForm schema as a draft form."""
    form = _save_form(db, str(user.tenant_id), body.title, body.json_schema)
    return {"id": str(form.id), "title": form.title, "status": form.status}


# ── Kobo ───────────────────────────────────────────────────────────────────────

class KoboConnectRequest(BaseModel):
    server: str = "https://kf.kobotoolbox.org"
    token: str


@router.post("/kobo/connect")
async def kobo_connect(body: KoboConnectRequest, user=Depends(require_org_admin)):
    """Validate Kobo credentials and return the user's form list."""
    client = KoboClient(body.server, body.token)
    try:
        forms = await client.list_forms()
    except Exception as e:
        raise HTTPException(400, f"Could not connect to Kobo: {e}")
    return {"forms": forms}


class KoboImportRequest(BaseModel):
    server: str = "https://kf.kobotoolbox.org"
    token: str
    asset_uid: str
    import_submissions: bool = False


@router.post("/kobo/import")
async def kobo_import(
    body: KoboImportRequest,
    user=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    client = KoboClient(body.server, body.token)

    # 1. Download XLSForm
    try:
        xls_bytes = await client.get_xlsform_bytes(body.asset_uid)
    except Exception as e:
        raise HTTPException(400, f"Could not download XLSForm from Kobo: {e}")

    # 2. Parse
    try:
        parsed = parse_xlsform(xls_bytes, filename=f"{body.asset_uid}.xlsx")
    except Exception as e:
        raise HTTPException(422, f"XLSForm parse error: {e}")

    # 3. Save form
    form = _save_form(db, str(user.tenant_id), parsed["title"], parsed["json_schema"])
    result: dict[str, Any] = {
        "form_id": str(form.id),
        "title": form.title,
        "warnings": parsed["warnings"],
        "submissions_imported": 0,
    }

    # 4. Optionally import submissions
    all_saved_rows: list[dict] = []
    if body.import_submissions:
        field_names = _extract_field_names(parsed["json_schema"].get("sections", []))
        page = 1
        total_imported = 0
        while True:
            try:
                data = await client.get_submissions(body.asset_uid, page=page)
            except Exception as e:
                result["warnings"].append(f"Submission fetch error (page {page}): {e}")
                break
            rows = data.get("results", [])
            if not rows:
                break
            count, saved_rows = _save_submissions(db, form, user, rows, field_names)
            total_imported += count
            all_saved_rows.extend(saved_rows)
            if not data.get("next"):
                break
            page += 1
        result["submissions_imported"] = total_imported

    _post_import_hooks(db, str(user.tenant_id), form, "KoboToolbox", result["submissions_imported"], all_saved_rows)
    return result


# ── SurveyCTO ──────────────────────────────────────────────────────────────────

class SCTOConnectRequest(BaseModel):
    server: str          # "yourserver" or full URL
    username: str
    password: str


@router.post("/surveycto/connect")
async def surveycto_connect(body: SCTOConnectRequest, user=Depends(require_org_admin)):
    client = SurveyCTOClient(body.server, body.username, body.password)
    try:
        forms = await client.list_forms()
    except Exception as e:
        raise HTTPException(400, f"Could not connect to SurveyCTO: {e}")
    return {"forms": forms}


class SCTOImportRequest(BaseModel):
    server: str
    username: str
    password: str
    form_id: str
    import_submissions: bool = False


@router.post("/surveycto/import")
async def surveycto_import(
    body: SCTOImportRequest,
    user=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    client = SurveyCTOClient(body.server, body.username, body.password)

    try:
        xls_bytes = await client.get_xlsform_bytes(body.form_id)
    except Exception as e:
        raise HTTPException(400, f"Could not download XLSForm from SurveyCTO: {e}")

    try:
        parsed = parse_xlsform(xls_bytes, filename=f"{body.form_id}.xlsx")
    except Exception as e:
        raise HTTPException(422, f"XLSForm parse error: {e}")

    form = _save_form(db, str(user.tenant_id), parsed["title"], parsed["json_schema"])
    result: dict[str, Any] = {
        "form_id": str(form.id),
        "title": form.title,
        "warnings": parsed["warnings"],
        "submissions_imported": 0,
    }

    saved_rows: list[dict] = []
    if body.import_submissions:
        field_names = _extract_field_names(parsed["json_schema"].get("sections", []))
        try:
            rows = await client.get_submissions(body.form_id)
            count, saved_rows = _save_submissions(db, form, user, rows, field_names)
            result["submissions_imported"] = count
        except Exception as e:
            result["warnings"].append(f"Submission import error: {e}")

    _post_import_hooks(db, str(user.tenant_id), form, "SurveyCTO", result["submissions_imported"], saved_rows)
    return result


# ── ODK Central ────────────────────────────────────────────────────────────────

class ODKConnectRequest(BaseModel):
    server: str
    username: str
    password: str
    project_id: int


@router.post("/odk/connect")
async def odk_connect(body: ODKConnectRequest, user=Depends(require_org_admin)):
    client = ODKCentralClient(body.server, body.username, body.password)
    try:
        forms = await client.list_forms(body.project_id)
    except Exception as e:
        raise HTTPException(400, f"Could not connect to ODK Central: {e}")
    return {"forms": forms}


class ODKImportRequest(BaseModel):
    server: str
    username: str
    password: str
    project_id: int
    form_id: str
    import_submissions: bool = False


@router.post("/odk/import")
async def odk_import(
    body: ODKImportRequest,
    user=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    client = ODKCentralClient(body.server, body.username, body.password)

    try:
        xls_bytes = await client.get_xlsform_bytes(body.project_id, body.form_id)
    except Exception as e:
        raise HTTPException(400, f"Could not download XLSForm from ODK Central: {e}")

    try:
        parsed = parse_xlsform(xls_bytes, filename=f"{body.form_id}.xlsx")
    except Exception as e:
        raise HTTPException(422, f"XLSForm parse error: {e}")

    form = _save_form(db, str(user.tenant_id), parsed["title"], parsed["json_schema"])
    result: dict[str, Any] = {
        "form_id": str(form.id),
        "title": form.title,
        "warnings": parsed["warnings"],
        "submissions_imported": 0,
    }

    saved_rows: list[dict] = []
    if body.import_submissions:
        field_names = _extract_field_names(parsed["json_schema"].get("sections", []))
        try:
            rows = await client.get_submissions(body.project_id, body.form_id)
            count, saved_rows = _save_submissions(db, form, user, rows, field_names)
            result["submissions_imported"] = count
        except Exception as e:
            result["warnings"].append(f"Submission import error: {e}")

    _post_import_hooks(db, str(user.tenant_id), form, "ODK Central", result["submissions_imported"], saved_rows)
    return result
