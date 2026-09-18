"""Audit log read + CSV export endpoints."""
import csv
import io
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import and_

from app.core.database import get_db
from app.core.deps import get_current_user, require_role
from app.models.audit_log import AuditLog
from app.models.user import User

router = APIRouter(prefix="/audit", tags=["audit"])


def _rows(db: Session, tenant_id, limit: int, offset: int, action: Optional[str], user_id: Optional[str]):
    q = db.query(AuditLog).filter(AuditLog.tenant_id == tenant_id)
    if action:
        q = q.filter(AuditLog.action == action)
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    return q.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()


@router.get("/")
def list_audit_log(
    limit: int = Query(100, le=500),
    offset: int = 0,
    action: Optional[str] = None,
    user_id: Optional[str] = None,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = _rows(db, user["tenant_id"], limit, offset, action, user_id)
    return [
        {
            "id": r.id,
            "action": r.action,
            "resource": r.resource,
            "resource_id": r.resource_id,
            "user_id": str(r.user_id) if r.user_id else None,
            "detail": r.detail,
            "ip_address": r.ip_address,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.get("/export.csv")
def export_audit_log_csv(
    limit: int = Query(10000, le=100000),
    offset: int = 0,
    action: Optional[str] = None,
    user_id: Optional[str] = None,
    user=Depends(require_role("org_admin")),
    db: Session = Depends(get_db),
):
    rows = _rows(db, user["tenant_id"], limit, offset, action, user_id)
    # Resolve user names for readability
    user_map: dict = {}
    for r in rows:
        if r.user_id and str(r.user_id) not in user_map:
            u = db.query(User).filter(User.id == r.user_id).first()
            user_map[str(r.user_id)] = u.name if u else str(r.user_id)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "timestamp", "action", "resource", "resource_id", "user_id", "user_name", "ip_address", "detail"])
    for r in rows:
        uid = str(r.user_id) if r.user_id else ""
        writer.writerow([
            r.id,
            r.created_at.isoformat() if r.created_at else "",
            r.action,
            r.resource or "",
            r.resource_id or "",
            uid,
            user_map.get(uid, ""),
            r.ip_address or "",
            str(r.detail) if r.detail else "",
        ])
    buf.seek(0)
    now = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="audit_log_{now}.csv"'},
    )
