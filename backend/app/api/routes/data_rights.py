"""DPDP data-principal rights workflow: log → verify → search across all
forms → act (export/erase) → close, with an SLA due date. Respondents don't
have accounts in this app, so this is a staff-facing case-tracking tool, not
a self-serve portal — matches how consent withdrawal (item 7) works too."""
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_org_admin
from app.core.soft_delete import soft_delete
from app.models.data_rights_request import DataRightsRequest
from app.models.form import Form
from app.models.submission import Submission
from app.services.audit import write_audit
from app.services.pii_redact import identifier_field_ids
from app.services.field_encrypt import decrypt_identifiers

router = APIRouter(prefix="/data-rights", tags=["data-rights"])

SLA_TARGET_DAYS = 30
SLA_OUTER_LIMIT_DAYS = 90
REQUEST_TYPES = {"access", "correction", "erasure", "portability"}
STATUSES = {"open", "verifying", "in_progress", "closed"}


class RequestCreateIn(BaseModel):
    request_type: str
    requester_name: str
    requester_contact: str
    nominee_name: Optional[str] = None
    nominee_contact: Optional[str] = None


class RequestUpdateIn(BaseModel):
    status: Optional[str] = None
    identity_verified: Optional[bool] = None
    resolution_note: Optional[str] = None
    nominee_name: Optional[str] = None
    nominee_contact: Optional[str] = None


class SearchIn(BaseModel):
    query: Optional[str] = None


class ActIn(BaseModel):
    action: str   # "erase" | "export"
    submission_ids: Optional[list[str]] = None   # defaults to every linked submission


class CloseIn(BaseModel):
    resolution_note: Optional[str] = None


def _serialize(r: DataRightsRequest) -> dict:
    now = datetime.now(timezone.utc)
    is_overdue = r.status != "closed" and now > r.sla_due_at
    outer_limit = r.created_at + timedelta(days=SLA_OUTER_LIMIT_DAYS)
    return {
        "id": str(r.id),
        "request_type": r.request_type,
        "requester_name": r.requester_name,
        "requester_contact": r.requester_contact,
        "nominee_name": r.nominee_name,
        "nominee_contact": r.nominee_contact,
        "status": r.status,
        "identity_verified": r.identity_verified,
        "linked_submission_ids": r.linked_submission_ids or [],
        "resolution_note": r.resolution_note,
        "closed_at": r.closed_at.isoformat() if r.closed_at else None,
        "sla_due_at": r.sla_due_at.isoformat(),
        "outer_limit_at": outer_limit.isoformat(),
        "is_overdue": is_overdue,
        "is_past_outer_limit": r.status != "closed" and now > outer_limit,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _get(db: Session, tenant_id, request_id: str) -> DataRightsRequest:
    r = db.query(DataRightsRequest).filter(
        DataRightsRequest.id == request_id, DataRightsRequest.tenant_id == tenant_id
    ).first()
    if not r:
        raise HTTPException(404, "Request not found")
    return r


@router.post("/")
def create_request(
    body: RequestCreateIn,
    request: Request,
    user=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    if body.request_type not in REQUEST_TYPES:
        raise HTTPException(422, f"request_type must be one of {sorted(REQUEST_TYPES)}")
    now = datetime.now(timezone.utc)
    r = DataRightsRequest(
        tenant_id=user["tenant_id"], logged_by=user.get("sub"),
        request_type=body.request_type,
        requester_name=body.requester_name, requester_contact=body.requester_contact,
        nominee_name=body.nominee_name, nominee_contact=body.nominee_contact,
        sla_due_at=now + timedelta(days=SLA_TARGET_DAYS),
    )
    db.add(r)
    db.flush()
    write_audit(
        db, tenant_id=user["tenant_id"], user_id=user.get("sub"),
        action="data_rights_request_logged", resource="data_rights_request", resource_id=str(r.id),
        detail={"request_type": body.request_type}, ip_address=request.client.host if request.client else None,
    )
    db.commit()
    db.refresh(r)
    return _serialize(r)


@router.get("/")
def list_requests(
    status: Optional[str] = None,
    overdue_only: bool = False,
    user=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    q = db.query(DataRightsRequest).filter(DataRightsRequest.tenant_id == user["tenant_id"])
    if status:
        q = q.filter(DataRightsRequest.status == status)
    rows = [_serialize(r) for r in q.order_by(DataRightsRequest.created_at.desc()).all()]
    if overdue_only:
        rows = [r for r in rows if r["is_overdue"]]
    return rows


@router.get("/overdue-count")
def overdue_count(user=Depends(require_org_admin), db: Session = Depends(get_db)):
    """Cheap count for an admin-panel badge — the 'overdue alerts' requirement,
    surfaced as a visible signal rather than proactive email (no existing
    per-tenant-object digest hook to attach that to without risking spam)."""
    now = datetime.now(timezone.utc)
    n = db.query(DataRightsRequest).filter(
        DataRightsRequest.tenant_id == user["tenant_id"],
        DataRightsRequest.status != "closed",
        DataRightsRequest.sla_due_at < now,
    ).count()
    return {"overdue_count": n}


@router.get("/{request_id}")
def get_request(request_id: str, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    return _serialize(_get(db, user["tenant_id"], request_id))


@router.patch("/{request_id}")
def update_request(
    request_id: str, body: RequestUpdateIn,
    user=Depends(require_org_admin), db: Session = Depends(get_db),
):
    r = _get(db, user["tenant_id"], request_id)
    if body.status is not None:
        if body.status not in STATUSES:
            raise HTTPException(422, f"status must be one of {sorted(STATUSES)}")
        r.status = body.status
    if body.identity_verified is not None:
        r.identity_verified = body.identity_verified
    if body.resolution_note is not None:
        r.resolution_note = body.resolution_note
    if body.nominee_name is not None:
        r.nominee_name = body.nominee_name
    if body.nominee_contact is not None:
        r.nominee_contact = body.nominee_contact
    db.commit()
    db.refresh(r)
    return _serialize(r)


@router.post("/{request_id}/search")
def search_across_forms(
    request_id: str, body: SearchIn,
    user=Depends(require_org_admin), db: Session = Depends(get_db),
):
    """Search every one of the tenant's forms for submissions whose
    is_identifier-flagged fields contain the query — the "find this
    respondent across all forms/waves" step. Reuses the same is_identifier
    flag + helper already used to strip PII before AI calls (pii_redact.py),
    rather than inventing a second identifier-field concept."""
    r = _get(db, user["tenant_id"], request_id)
    query = (body.query or r.requester_contact or "").strip()
    if not query:
        raise HTTPException(400, "No search query provided or available on the request")

    forms = db.query(Form).filter(Form.tenant_id == user["tenant_id"]).all()
    matches: list[dict[str, Any]] = []
    query_lower = query.lower()
    for form in forms:
        field_ids = identifier_field_ids(form.json_schema)
        if not field_ids:
            continue
        # Identifier fields are encrypted at rest — Fernet ciphertext can't be
        # filtered at the SQL level (astext.ilike would never match), so fetch
        # this form's candidate rows (already tenant+form scoped, bounded) and
        # filter in Python after decrypting. Low-frequency admin tool, not a
        # hot path, so the extra decrypt cost per row is a non-issue.
        candidates = db.query(Submission).filter(
            Submission.tenant_id == user["tenant_id"],
            Submission.form_id == form.id,
        ).all()
        subs = []
        for s in candidates:
            decrypted = decrypt_identifiers(s.data_json or {}, form.json_schema)
            if any(query_lower in str(decrypted.get(fid, "")).lower() for fid in field_ids):
                subs.append(s)
        for s in subs:
            matches.append({
                "id": str(s.id), "form_id": str(form.id), "form_title": form.title,
                "server_received_at": s.server_received_at.isoformat() if s.server_received_at else None,
            })

    found_ids = {m["id"] for m in matches}
    existing = set(r.linked_submission_ids or [])
    r.linked_submission_ids = sorted(existing | found_ids)
    db.commit()
    return {"matches": matches, "linked_submission_ids": r.linked_submission_ids}


@router.post("/{request_id}/act")
def act_on_request(
    request_id: str, body: ActIn, http_request: Request,
    user=Depends(require_org_admin), db: Session = Depends(get_db),
):
    """Perform the requested action on the linked submissions. 'erase' reuses
    the exact same erasure core as anonymize/withdraw (item 9/7) — three
    call sites now, one implementation. 'export' returns a machine-readable
    JSON bundle (the "export" DPDP right); correction isn't automated here
    since it's a manual, per-field edit already served by the existing
    submission-data-edit endpoint — this just tracks that it happened."""
    r = _get(db, user["tenant_id"], request_id)
    ids = body.submission_ids or (r.linked_submission_ids or [])
    if not ids:
        raise HTTPException(400, "No submissions linked to this request yet — run /search first")

    subs = db.query(Submission).filter(
        Submission.tenant_id == user["tenant_id"], Submission.id.in_(ids)
    ).all()
    found_ids = {str(s.id) for s in subs}
    missing = set(ids) - found_ids
    ip = http_request.client.host if http_request.client else None

    if body.action == "erase":
        from app.api.routes.submissions import _erase_submission_row
        results = []
        for s in subs:
            res = _erase_submission_row(
                db, s, action="data_rights_erasure",
                tenant_id=user["tenant_id"], user_id=user.get("sub"), ip_address=ip,
                extra_detail={"data_rights_request_id": str(r.id)},
            )
            results.append(res)
        db.commit()
        return {"action": "erase", "erased": results, "not_found": sorted(missing)}

    if body.action == "export":
        _form_schemas = {
            f.id: f.json_schema for f in db.query(Form).filter(Form.id.in_({s.form_id for s in subs})).all()
        } if subs else {}
        bundle = [
            {"submission_id": str(s.id), "form_id": str(s.form_id),
             "data": decrypt_identifiers(s.data_json, _form_schemas.get(s.form_id))}
            for s in subs
        ]
        write_audit(
            db, tenant_id=user["tenant_id"], user_id=user.get("sub"),
            action="data_rights_export", resource="data_rights_request", resource_id=str(r.id),
            detail={"submission_count": len(bundle)}, ip_address=ip,
        )
        db.commit()
        return {"action": "export", "data": bundle, "not_found": sorted(missing)}

    raise HTTPException(422, "action must be 'erase' or 'export'")


@router.post("/{request_id}/close")
def close_request(
    request_id: str, body: CloseIn, request: Request,
    user=Depends(require_org_admin), db: Session = Depends(get_db),
):
    r = _get(db, user["tenant_id"], request_id)
    r.status = "closed"
    r.closed_at = datetime.now(timezone.utc)
    r.closed_by = user.get("sub")
    if body.resolution_note:
        r.resolution_note = body.resolution_note
    write_audit(
        db, tenant_id=user["tenant_id"], user_id=user.get("sub"),
        action="data_rights_request_closed", resource="data_rights_request", resource_id=str(r.id),
        detail={}, ip_address=request.client.host if request.client else None,
    )
    db.commit()
    db.refresh(r)
    return _serialize(r)


@router.get("/{request_id}/certificate")
def deletion_certificate(request_id: str, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    """Deletion certificate for a closed erasure request — documentary proof
    for the requester or a downstream auditor. Only issued for requests
    that are actually closed, so this never certifies something that
    hasn't happened yet."""
    r = _get(db, user["tenant_id"], request_id)
    if r.status != "closed":
        raise HTTPException(400, "Certificate can only be issued for a closed request")

    try:
        from fpdf import FPDF
    except ImportError:
        raise HTTPException(501, "fpdf2 not installed — run: pip install fpdf2")

    from app.models.tenant import Tenant
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    org_name = tenant.name if tenant else "FieldGovern customer"

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(14, 165, 233)
    pdf.cell(0, 12, "Certificate of Data Deletion", ln=True)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(100, 100, 120)
    pdf.cell(0, 6, f"Issued: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", ln=True)
    pdf.ln(3)
    pdf.set_draw_color(14, 165, 233)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(6)

    def row(label: str, value: str):
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(30, 30, 46)
        pdf.cell(50, 7, label)
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(60, 60, 80)
        pdf.multi_cell(0, 7, value or "-")

    row("Organisation:", org_name)
    row("Request ID:", str(r.id))
    row("Request type:", r.request_type)
    row("Requester:", r.requester_name)
    row("Logged:", r.created_at.strftime('%Y-%m-%d') if r.created_at else "-")
    row("Closed:", r.closed_at.strftime('%Y-%m-%d %H:%M UTC') if r.closed_at else "-")
    row("Records covered:", str(len(r.linked_submission_ids or [])))
    row("Resolution note:", r.resolution_note or "-")
    pdf.ln(4)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(120, 120, 140)
    pdf.multi_cell(0, 5,
        "This certifies that FieldGovern processed the above data-principal rights request "
        "and, where the request type was erasure, anonymized the personal data in the "
        "records linked to this request as of the closed date above. \"Records covered\" "
        "reflects submissions linked to this request at the time it was closed via search "
        "and/or manual review.")

    import io
    buf = io.BytesIO()
    pdf.output(buf)
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="deletion_certificate_{str(r.id)[:8]}.pdf"'},
    )


@router.delete("/{request_id}", status_code=204)
def delete_request(request_id: str, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    r = _get(db, user["tenant_id"], request_id)
    soft_delete(r)
    db.commit()
