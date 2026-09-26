"""Signup-lead capture. Never raises — lead tracking must not break signup/login."""
import logging
from typing import Optional
from sqlalchemy.orm import Session
from app.models.signup_lead import SignupLead

logger = logging.getLogger(__name__)

_RANK = {"lead": 0, "attempted": 1, "registered": 2}


def record_lead(
    db: Session, email: Optional[str], source: str, status: str = "lead",
    phone: Optional[str] = None, name: Optional[str] = None, org_name: Optional[str] = None,
    note: Optional[str] = None, ip: Optional[str] = None,
) -> None:
    email = (email or "").strip().lower()
    if not email or "@" not in email or len(email) > 320:
        return
    try:
        lead = db.query(SignupLead).filter(SignupLead.email == email).first()
        if lead is None:
            db.add(SignupLead(
                email=email, phone=phone, name=name, org_name=org_name, source=source,
                status=status, note=note, ip=ip,
            ))
        else:
            lead.attempts = (lead.attempts or 0) + 1
            lead.phone = phone or lead.phone
            lead.name = name or lead.name
            lead.org_name = org_name or lead.org_name
            lead.note = note or lead.note
            lead.ip = ip or lead.ip
            if _RANK.get(status, 0) >= _RANK.get(lead.status, 0):
                lead.status = status
            from sqlalchemy import func
            lead.last_seen_at = func.now()
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("record_lead failed")
