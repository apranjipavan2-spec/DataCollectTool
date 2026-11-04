"""Read-only, aggregate-only results links for outsiders (migration 0066).

Admin (org_admin):  POST/GET/DELETE /dashboard-shares
Public (no login):  GET /public/results/{token}  → totals only, see services/results_aggregate.py
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.database import get_db, set_tenant_context
from app.core.deps import assert_tenant_active, require_org_admin
from app.core.rate_limit import limiter
from app.models.dashboard_share import DashboardShare
from app.models.form import Form
from app.models.submission import Submission
from app.services.results_aggregate import MIN_CELL, build_results

router = APIRouter()

_EXCLUDED_STATUSES = ("draft", "rejected")


def _serialize(s: DashboardShare) -> dict:
    return {
        "id": str(s.id),
        "form_id": str(s.form_id),
        "label": s.label,
        "url": f"/results/{s.token}",
        "expires_at": s.expires_at.isoformat() if s.expires_at else None,
        "revoked": s.revoked_at is not None,
        "view_count": s.view_count,
        "last_viewed_at": s.last_viewed_at.isoformat() if s.last_viewed_at else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


class ShareCreate(BaseModel):
    form_id: str
    label: Optional[str] = None
    expires_at: Optional[datetime] = None


@router.post("/dashboard-shares", status_code=201)
def create_share(body: ShareCreate, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    try:
        fid = uuid.UUID(body.form_id)
    except ValueError:
        raise HTTPException(400, "Invalid form id")
    form = db.query(Form).filter(Form.id == fid, Form.tenant_id == uuid.UUID(str(user["tenant_id"]))).first()
    if not form:
        raise HTTPException(404, "Form not found")
    expires = body.expires_at
    if expires and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires and expires <= datetime.now(timezone.utc):
        raise HTTPException(422, "Expiry date must be in the future")
    share = DashboardShare(
        tenant_id=form.tenant_id, form_id=form.id, token=secrets.token_urlsafe(24),
        label=(body.label or "").strip()[:200] or None, created_by=user["sub"], expires_at=expires,
    )
    db.add(share)
    db.commit()
    db.refresh(share)
    return _serialize(share)


@router.get("/dashboard-shares")
def list_shares(form_id: Optional[str] = None, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    q = db.query(DashboardShare).filter(DashboardShare.tenant_id == uuid.UUID(str(user["tenant_id"])))
    if form_id:
        try:
            q = q.filter(DashboardShare.form_id == uuid.UUID(form_id))
        except ValueError:
            raise HTTPException(400, "Invalid form id")
    return [_serialize(s) for s in q.order_by(DashboardShare.created_at.desc()).all()]


@router.delete("/dashboard-shares/{share_id}")
def revoke_share(share_id: str, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    try:
        sid = uuid.UUID(share_id)
    except ValueError:
        raise HTTPException(400, "Invalid share id")
    share = db.query(DashboardShare).filter(
        DashboardShare.id == sid, DashboardShare.tenant_id == uuid.UUID(str(user["tenant_id"]))
    ).first()
    if not share:
        raise HTTPException(404, "Share link not found")
    if share.revoked_at is None:
        share.revoked_at = datetime.now(timezone.utc)
        db.commit()
    return _serialize(share)


@router.get("/public/results/{token}")
@limiter.limit("30/minute")
def public_results(token: str, request: Request, db: Session = Depends(get_db)):
    """No login. Same 404 for unknown, revoked and expired links — no oracle."""
    share = db.query(DashboardShare).filter(DashboardShare.token == token).first()
    now = datetime.now(timezone.utc)
    if not share or share.revoked_at or (share.expires_at and share.expires_at <= now):
        raise HTTPException(404, "This results link is not available")
    set_tenant_context(db, str(share.tenant_id))
    try:
        assert_tenant_active(db, share.tenant_id)  # suspended org → link stops working
    except HTTPException:
        raise HTTPException(404, "This results link is not available")
    form = db.query(Form).filter(Form.id == share.form_id).first()
    if not form:
        raise HTTPException(404, "This results link is not available")

    subs = (
        db.query(Submission.data_json, Submission.enumerator_id,
                 func.coalesce(Submission.local_created_at, Submission.server_received_at))
        .filter(Submission.form_id == form.id,
                Submission.is_duplicate == False,  # noqa: E712
                or_(Submission.status.is_(None), ~Submission.status.in_(_EXCLUDED_STATUSES)))
        .all()
    )
    rows = [(d, e, ts.date().isoformat() if ts else None) for d, e, ts in subs]
    result = build_results(form.json_schema or {}, rows)

    share.view_count = (share.view_count or 0) + 1
    share.last_viewed_at = now
    db.commit()
    return {
        "form_title": form.title,
        "label": share.label,
        "generated_at": now.isoformat(),
        "expires_at": share.expires_at.isoformat() if share.expires_at else None,
        "min_cell": MIN_CELL,
        **result,
    }
