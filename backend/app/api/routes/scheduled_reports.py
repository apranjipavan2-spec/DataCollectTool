"""CRUD endpoints for scheduled report delivery."""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import require_supervisor
from app.models.scheduled_report import ScheduledReport
from app.core.soft_delete import soft_delete

router = APIRouter(prefix="/scheduled-reports", tags=["scheduled-reports"])


@router.get("/")
def list_scheduled_reports(user=Depends(require_supervisor), db: Session = Depends(get_db)):
    rows = db.query(ScheduledReport).filter(ScheduledReport.tenant_id == user["tenant_id"]).all()
    return [_serialize(r) for r in rows]


@router.post("/")
def create_scheduled_report(body: dict, user=Depends(require_supervisor), db: Session = Depends(get_db)):
    sr = ScheduledReport(
        tenant_id        = user["tenant_id"],
        created_by       = user["sub"],
        name             = body.get("name", "Scheduled Report"),
        program_id       = body.get("program_id") or None,
        style            = body.get("style", "field_survey"),
        custom_context   = body.get("custom_context", ""),
        frequency        = body.get("frequency", "weekly"),
        send_hour        = str(body.get("send_hour", 7)),
        send_dow         = str(body.get("send_dow", 1)) if body.get("frequency") == "weekly" else None,
        recipient_emails = body.get("recipient_emails", []),
        is_active        = body.get("is_active", True),
    )
    db.add(sr)
    db.commit()
    db.refresh(sr)
    return _serialize(sr)


@router.patch("/{sr_id}")
def update_scheduled_report(sr_id: str, body: dict, user=Depends(require_supervisor), db: Session = Depends(get_db)):
    sr = _get_or_404(sr_id, user, db)
    for field in ("name", "style", "custom_context", "frequency", "send_hour", "send_dow", "recipient_emails", "is_active", "program_id"):
        if field in body:
            setattr(sr, field, body[field])
    db.commit()
    db.refresh(sr)
    return _serialize(sr)


@router.delete("/{sr_id}", status_code=204)
def delete_scheduled_report(sr_id: str, user=Depends(require_supervisor), db: Session = Depends(get_db)):
    sr = _get_or_404(sr_id, user, db)
    soft_delete(sr)
    db.commit()


def _get_or_404(sr_id: str, user: dict, db: Session) -> ScheduledReport:
    sr = db.query(ScheduledReport).filter(
        ScheduledReport.id == sr_id,
        ScheduledReport.tenant_id == user["tenant_id"],
    ).first()
    if not sr:
        raise HTTPException(404, "Not found")
    return sr


def _serialize(sr: ScheduledReport) -> dict:
    return {
        "id": str(sr.id),
        "name": sr.name,
        "program_id": str(sr.program_id) if sr.program_id else None,
        "style": sr.style,
        "custom_context": sr.custom_context,
        "frequency": sr.frequency,
        "send_hour": sr.send_hour,
        "send_dow": sr.send_dow,
        "recipient_emails": sr.recipient_emails or [],
        "is_active": sr.is_active,
        "last_sent_at": sr.last_sent_at.isoformat() if sr.last_sent_at else None,
        "created_at": sr.created_at.isoformat() if sr.created_at else None,
    }
