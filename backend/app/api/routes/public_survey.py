"""Public survey endpoints — no auth required for submission."""
import logging
import secrets
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func

logger = logging.getLogger(__name__)

from app.core.database import get_db
from app.core.deps import require_role
from app.models.form import Form
from app.models.submission import Submission

router = APIRouter()

require_org_admin = require_role("org_admin")


def _get_redis():
    try:
        import redis as _redis
        from app.core.config import settings
        return _redis.from_url(settings.REDIS_URL, decode_responses=True)
    except Exception:
        return None


@router.get("/survey/{token}/info")
def public_survey_info(token: str, db: Session = Depends(get_db)):
    form = db.query(Form).filter(
        Form.public_token == token,
        Form.is_public == True,
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Survey not found or no longer active")
    return {
        "title": form.title,
        "json_schema": form.json_schema,
        "form_id": str(form.id),
    }


@router.post("/survey/{token}/submit")
def public_survey_submit(token: str, body: dict, request: Request, db: Session = Depends(get_db)):
    form = db.query(Form).filter(
        Form.public_token == token,
        Form.is_public == True,
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Survey not found or no longer active")

    client_ip = request.client.host if request.client else "unknown"
    r = _get_redis()
    if r:
        rl_key = f"rl:pub:{token}:{client_ip}"
        count = r.incr(rl_key)
        if count == 1:
            r.expire(rl_key, 3600)
        if count > 10:
            raise HTTPException(status_code=429, detail="Too many submissions. Please try again later.")

    max_serial = db.query(func.max(Submission.serial_no)).filter(
        Submission.form_id == form.id
    ).scalar() or 0

    data_json = body.get("data_json", body)
    sub = Submission(
        form_id=form.id,
        tenant_id=form.tenant_id,
        enumerator_id=None,
        data_json=data_json,
        status="submitted",
        form_version=str(form.version),
        serial_no=max_serial + 1,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    if form.sheets_sync_config and form.sheets_sync_config.get("enabled"):
        try:
            from app.services.sheets import sync_submission
            sync_submission(form, sub)
        except Exception as e:
            logger.error("Sheets sync failed for submission %s: %s", sub.id, e, exc_info=True)

    return {"id": str(sub.id), "serial_no": sub.serial_no}


@router.post("/forms/{form_id}/make-public")
def make_form_public(form_id: str, user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    form = db.query(Form).filter(
        Form.id == form_id,
        Form.tenant_id == user["tenant_id"],
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    # Reuse the existing token if the form is already public — regenerating on
    # every click would silently invalidate links that were already shared.
    token = form.public_token or secrets.token_urlsafe(32)
    form.public_token = token
    form.is_public = True
    db.commit()
    return {"public_url": f"/survey/{token}", "token": token}


@router.post("/forms/{form_id}/make-private")
def make_form_private(form_id: str, user: dict = Depends(require_org_admin), db: Session = Depends(get_db)):
    form = db.query(Form).filter(
        Form.id == form_id,
        Form.tenant_id == user["tenant_id"],
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    form.is_public = False
    form.public_token = None
    db.commit()
    return {"ok": True}
