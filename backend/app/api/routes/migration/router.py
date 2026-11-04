"""
Migration API — import forms and submissions from XLSForm, Kobo, SurveyCTO, ODK Central.

All endpoints require org_admin role.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

import re as _re
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import text as sa_text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_org_admin
from app.models.form import Form
from app.models.submission import Submission
from app.models.tenant import Tenant
from app.services.whatsapp import notify as wa_notify
from app.services.telegram import notify as tg_notify
from app.services.sheets_sync import bulk_sync_submissions
from app.services.pii_redact import mask_aadhaar_in_data
from app.services.field_encrypt import encrypt_identifiers

from .xlsform_parser import parse_xlsform
from .xlsform_serializer import serialize_xlsform
from .platform_clients import (
    KoboClient, SurveyCTOClient, ODKCentralClient, UnsafeServerURL, map_submission_data,
)

router = APIRouter()

_MAX_FILE = 20 * 1024 * 1024  # 20 MB


# ── helpers ────────────────────────────────────────────────────────────────────

def _extract_fields(sections: list[dict]) -> dict[str, dict]:
    """name → field for top-level fields; repeat_group fields keep their children."""
    return {f["name"]: f for sec in sections for f in sec.get("fields", []) if f.get("name")}


def _upstream_error(platform: str, e: Exception) -> HTTPException:
    """Turn a client/HTTP failure into a message the org admin can act on."""
    if isinstance(e, UnsafeServerURL):
        return HTTPException(400, str(e))
    if isinstance(e, httpx.HTTPStatusError):
        code = e.response.status_code
        if code == 401:
            return HTTPException(401, f"Invalid {platform} credentials / API token")
        if code == 403:
            return HTTPException(403, f"{platform} account has no access to this form")
        if code == 404:
            return HTTPException(404, f"Form not found on {platform} (check server URL and form)")
        return HTTPException(502, f"{platform} returned HTTP {code}")
    if isinstance(e, httpx.RequestError):
        return HTTPException(400, f"Could not reach {platform} server: {e.__class__.__name__}")
    return HTTPException(400, f"{platform} error: {e}")


# Per-platform: unique submission id (dedupe key) and original submission time.
def _source_meta(platform: str, raw: dict) -> tuple[str | None, datetime | None, dict]:
    if platform == "kobo":
        key, ts, src = raw.get("_uuid"), raw.get("_submission_time"), {
            "id": raw.get("_id"), "submitted_by": raw.get("_submitted_by")}
    elif platform == "odk":
        system = raw.get("__system") or {}
        key, ts, src = raw.get("__id"), system.get("submissionDate"), {
            "submitted_by": system.get("submitterName")}
    else:  # surveycto
        key, ts, src = raw.get("KEY"), raw.get("SubmissionDate"), {}
    when = None
    if isinstance(ts, str) and ts:
        for parse in (lambda s: datetime.fromisoformat(s.replace("Z", "+00:00")),
                      lambda s: datetime.strptime(s, "%b %d, %Y %I:%M:%S %p")):
            try:
                when = parse(ts)
                break
            except ValueError:
                pass
        if when and when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)  # Kobo/SCTO times are UTC
    meta = {"platform": platform, **{k: v for k, v in src.items() if v is not None}}
    return (f"{platform}:{key}" if key else None), when, meta


def _find_imported_form(db: Session, tenant_id: str, platform: str, source_id: str) -> Form | None:
    return db.query(Form).filter(
        Form.tenant_id == uuid.UUID(tenant_id),
        Form.json_schema["_source"]["platform"].astext == platform,
        Form.json_schema["_source"]["id"].astext == source_id,
    ).order_by(Form.created_at.desc()).first()


def _post_import_hooks(db: Session, tenant_id: str, form: Form, platform: str, submissions_imported: int, saved_rows: list[dict]) -> None:
    """Fire WhatsApp + Telegram notification + Sheets sync after any platform import. Never raises."""
    try:
        import asyncio
        tenant = db.query(Tenant).filter(Tenant.id == uuid.UUID(tenant_id)).first()
        if tenant:
            notify_params = {
                "platform": platform,
                "form_title": form.title,
                "count": submissions_imported,
            }
            wa_notify(tenant, "import.complete", notify_params)
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.ensure_future(tg_notify(tenant, "import.complete", notify_params))
            except Exception:
                pass
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
    fields: dict[str, dict],
    platform: str,
) -> tuple[int, int, list[dict]]:
    """Returns (saved, skipped_already_imported, data_jsons for Sheets sync).

    Idempotent: local_id = "<platform>:<source uuid>", so re-importing skips rows
    already present — including binned ones, so deleted rows are not revived."""
    metas = [_source_meta(platform, raw) for raw in raw_submissions]
    keys = [m[0] for m in metas if m[0]]
    existing = {
        r[0] for r in db.query(Submission.local_id)
        .filter(Submission.form_id == form.id, Submission.local_id.in_(keys))
        .execution_options(include_deleted=True)
    } if keys else set()

    saved = skipped = 0
    data_rows: list[dict] = []
    for raw, (key, when, src) in zip(raw_submissions, metas):
        if key and key in existing:
            skipped += 1
            continue
        existing.add(key)
        # data stays plaintext for the returned data_rows (downstream Sheets sync
        # does its own identifier redaction); only the stored row is encrypted.
        data = mask_aadhaar_in_data(map_submission_data(raw, fields))
        data["_source"] = src
        sub = Submission(
            id=uuid.uuid4(),
            tenant_id=form.tenant_id,
            form_id=form.id,
            form_version=form.version,
            data_json=encrypt_identifiers(data, form.json_schema),
            status="synced",
            enumerator_id=user["sub"],
            local_id=key or str(uuid.uuid4()),
            local_created_at=when,
        )
        db.add(sub)
        data_rows.append(data)
        saved += 1
    if saved:
        db.commit()
    return saved, skipped, data_rows


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
    form = _save_form(db, str(user["tenant_id"]), body.title, body.json_schema)
    return {"id": str(form.id), "title": form.title, "status": form.status}


@router.post("/xlsform/serialize")
def xlsform_serialize(
    body: XLSFormSaveRequest,
    user=Depends(require_org_admin),
):
    """Serialize an in-memory schema (as edited in the builder) to a downloadable XLSForm."""
    xlsx = serialize_xlsform(body.title, body.json_schema or {},
                             version=int((body.json_schema or {}).get("version", 1) or 1))
    safe = _re.sub(r"[^A-Za-z0-9._-]+", "_", body.title).strip("_") or "form"
    filename = f"{safe}.xlsx"
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/xlsform/export/{form_id}")
def xlsform_export(
    form_id: str,
    user=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    """Download an existing form as an XLSForm .xlsx (re-importable into FieldGovern)."""
    try:
        fid = uuid.UUID(form_id)
    except ValueError:
        raise HTTPException(400, "Invalid form id")
    form = db.query(Form).filter(
        Form.id == fid, Form.tenant_id == uuid.UUID(str(user["tenant_id"]))
    ).first()
    if not form:
        raise HTTPException(404, "Form not found")

    xlsx = serialize_xlsform(form.title, form.json_schema or {}, str(form.id), form.version)
    safe = _re.sub(r"[^A-Za-z0-9._-]+", "_", form.title).strip("_") or "form"
    filename = f"{safe}_v{form.version}.xlsx"
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}"},
    )


# ── shared platform import ─────────────────────────────────────────────────────

async def _run_import(
    db: Session,
    user,
    platform: str,           # "kobo" | "surveycto" | "odk" — stored in _source / local_id
    label: str,              # human name for messages + notifications
    source_id: str,          # platform form id, used to find a previous import
    fetch_xls,               # () -> awaitable[bytes]
    pages,                   # () -> async iterator of list[raw submission]
    import_submissions: bool,
) -> dict:
    tenant_id = str(user["tenant_id"])
    try:
        xls_bytes = await fetch_xls()
    except Exception as e:
        raise _upstream_error(label, e)
    try:
        parsed = parse_xlsform(xls_bytes, filename=f"{source_id}.xlsx")
    except Exception as e:
        raise HTTPException(422, f"XLSForm parse error: {e}")

    warnings: list[str] = parsed["warnings"]
    form = _find_imported_form(db, tenant_id, platform, source_id)
    reused = form is not None
    if reused:
        warnings.append(f"Form already imported earlier — reused '{form.title}'; its design was not changed.")
    else:
        schema = {**parsed["json_schema"], "_source": {"platform": platform, "id": source_id}}
        form = _save_form(db, tenant_id, parsed["title"], schema)

    imported = skipped = 0
    saved_rows: list[dict] = []
    if import_submissions:
        fields = _extract_fields(parsed["json_schema"].get("sections", []))
        # Dedupe is read-then-insert (see lessons L031): serialise imports of the
        # same form. Session-level lock because _save_submissions commits per page.
        lock_key = f"migration-import:{form.id}"
        db.execute(sa_text("SELECT pg_advisory_lock(hashtext(:k))"), {"k": lock_key})
        try:
            async for rows in pages():
                n, s, data = _save_submissions(db, form, user, rows, fields, platform)
                imported += n
                skipped += s
                saved_rows.extend(data)
        except Exception as e:
            db.rollback()
            warnings.append(f"Submission import stopped after {imported} rows: {_upstream_error(label, e).detail}")
        finally:
            db.execute(sa_text("SELECT pg_advisory_unlock(hashtext(:k))"), {"k": lock_key})
            db.commit()

    _post_import_hooks(db, tenant_id, form, label, imported, saved_rows)
    return {
        "form_id": str(form.id),
        "title": form.title,
        "warnings": warnings,
        "submissions_imported": imported,
        "submissions_skipped": skipped,
        "reused_form": reused,
    }


async def _single_page(fetch):
    rows = await fetch()
    if rows:
        yield rows


# ── Kobo ───────────────────────────────────────────────────────────────────────

class KoboConnectRequest(BaseModel):
    server: str = "https://kf.kobotoolbox.org"
    token: str


@router.post("/kobo/connect")
async def kobo_connect(body: KoboConnectRequest, user=Depends(require_org_admin)):
    """Validate Kobo credentials and return the user's survey list (all pages)."""
    try:
        forms = await KoboClient(body.server, body.token).list_forms()
    except Exception as e:
        raise _upstream_error("KoboToolbox", e)
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
    try:
        client = KoboClient(body.server, body.token)
    except Exception as e:
        raise _upstream_error("KoboToolbox", e)
    return await _run_import(
        db, user, "kobo", "KoboToolbox", body.asset_uid,
        lambda: client.get_xlsform_bytes(body.asset_uid),
        lambda: client.iter_submissions(body.asset_uid),
        body.import_submissions,
    )


# ── SurveyCTO ──────────────────────────────────────────────────────────────────

class SCTOConnectRequest(BaseModel):
    server: str          # "yourserver" or full URL
    username: str
    password: str


@router.post("/surveycto/connect")
async def surveycto_connect(body: SCTOConnectRequest, user=Depends(require_org_admin)):
    try:
        forms = await SurveyCTOClient(body.server, body.username, body.password).list_forms()
    except Exception as e:
        raise _upstream_error("SurveyCTO", e)
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
    try:
        client = SurveyCTOClient(body.server, body.username, body.password)
    except Exception as e:
        raise _upstream_error("SurveyCTO", e)
    return await _run_import(
        db, user, "surveycto", "SurveyCTO", body.form_id,
        lambda: client.get_xlsform_bytes(body.form_id),
        lambda: _single_page(lambda: client.get_submissions(body.form_id)),
        body.import_submissions,
    )


# ── ODK Central ────────────────────────────────────────────────────────────────

class ODKConnectRequest(BaseModel):
    server: str
    username: str
    password: str
    project_id: int


@router.post("/odk/connect")
async def odk_connect(body: ODKConnectRequest, user=Depends(require_org_admin)):
    try:
        forms = await ODKCentralClient(body.server, body.username, body.password).list_forms(body.project_id)
    except Exception as e:
        raise _upstream_error("ODK Central", e)
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
    try:
        client = ODKCentralClient(body.server, body.username, body.password)
    except Exception as e:
        raise _upstream_error("ODK Central", e)
    return await _run_import(
        db, user, "odk", "ODK Central", f"{body.project_id}/{body.form_id}",
        lambda: client.get_xlsform_bytes(body.project_id, body.form_id),
        lambda: _single_page(lambda: client.get_submissions(body.project_id, body.form_id)),
        body.import_submissions,
    )
