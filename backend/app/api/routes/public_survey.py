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
from app.core.config import settings
from app.core.survey_crypto import decrypt_capsule, get_or_create_keypair, CapsuleError
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
        # Public key the page uses to encrypt a downloadable backup file.
        # Auto-created on first use, so this is present with zero setup.
        "recovery_public_key": get_or_create_keypair(db)[0],
    }


def _rate_limit(token: str, request: Request, limit: int = 10) -> None:
    """Hourly count cap (used by recovery). Kept for bulk endpoints."""
    client_ip = request.client.host if request.client else "unknown"
    r = _get_redis()
    if r:
        rl_key = f"rl:pub:{token}:{client_ip}"
        count = r.incr(rl_key)
        if count == 1:
            r.expire(rl_key, 3600)
        if count > limit:
            raise HTTPException(status_code=429, detail="Too many submissions. Please try again later.")


def _throttle_interval(key: str, request: Request, seconds: int = 15) -> None:
    """Min-interval throttle: at most one submission per `seconds` per IP.

    Blocks rapid bot spam while letting steady field collection through. Pairs
    with the client's 15s auto-retry — a throttled submission is never lost, it
    just lands on the next retry once the window clears. No-op if Redis is down.
    """
    client_ip = request.client.host if request.client else "unknown"
    r = _get_redis()
    if r:
        rl_key = f"rl:pubint:{key}:{client_ip}"
        # SET NX EX succeeds only if no submission from this IP in the last window.
        allowed = r.set(rl_key, "1", nx=True, ex=seconds)
        if not allowed:
            raise HTTPException(
                status_code=429,
                detail="Please wait a few seconds before submitting again — your response is saved and will send automatically.",
            )


def _persist_submission(db: Session, form: Form, data_json: dict, local_id: str | None):
    """Create a public submission, idempotent on (form_id, local_id).

    Returns (submission, created). If a submission with the same local_id already
    exists for this form, it is returned unchanged — so a retried upload OR a
    recovered backup file for the same response never creates a duplicate."""
    if local_id:
        existing = db.query(Submission).filter(
            Submission.form_id == form.id,
            Submission.local_id == str(local_id),
        ).first()
        if existing:
            return existing, False

    max_serial = db.query(func.max(Submission.serial_no)).filter(
        Submission.form_id == form.id
    ).scalar() or 0

    sub = Submission(
        form_id=form.id,
        tenant_id=form.tenant_id,
        enumerator_id=None,
        data_json=data_json,
        status="submitted",
        form_version=str(form.version),
        serial_no=max_serial + 1,
        local_id=str(local_id) if local_id else None,
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
    return sub, True


@router.post("/survey/{token}/submit")
def public_survey_submit(token: str, body: dict, request: Request, db: Session = Depends(get_db)):
    form = db.query(Form).filter(
        Form.public_token == token,
        Form.is_public == True,
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Survey not found or no longer active")

    _throttle_interval(token, request, seconds=15)  # ≤1 submission / 15s per IP

    data_json = body.get("data_json", body)
    local_id = body.get("local_id")
    sub, _ = _persist_submission(db, form, data_json, local_id)
    return {"id": str(sub.id), "serial_no": sub.serial_no}


@router.get("/recovery/public-key")
def recovery_public_key(db: Session = Depends(get_db)):
    """Public RSA key any survey device uses to encrypt an offline backup.
    Auto-created on first use — present with zero setup."""
    return {"public_key": get_or_create_keypair(db)[0]}


@router.post("/survey/recover")
def public_survey_recover(body: dict, request: Request, db: Session = Depends(get_db)):
    """Recover offline-backup capsules (.fgresp files). No auth — the capsule can
    only be decrypted with our private key, which proves it originated from us."""
    _, private_pem = get_or_create_keypair(db)
    if not private_pem:
        raise HTTPException(status_code=503, detail="Offline recovery is not available on this server")

    capsules = body.get("capsules")
    if not isinstance(capsules, list) or not capsules:
        raise HTTPException(status_code=400, detail="No capsules provided")
    if len(capsules) > 200:
        raise HTTPException(status_code=413, detail="Too many capsules in one request (max 200)")

    _rate_limit("recover", request, limit=60)  # bulk device recovery is legitimate

    results = []
    for i, envelope in enumerate(capsules):
        try:
            payload = decrypt_capsule(envelope, private_pem)
        except CapsuleError as e:
            results.append({"index": i, "status": "error", "detail": str(e)})
            continue

        # Payload is { data_json, ... }; tolerate a bare data_json for safety.
        data_json = payload.get("data_json", payload) if isinstance(payload, dict) else payload
        token = (envelope or {}).get("token")
        form = db.query(Form).filter(Form.public_token == token, Form.is_public == True).first()
        if not form:
            results.append({"index": i, "status": "error", "detail": "survey not found or inactive"})
            continue

        capsule_id = (envelope or {}).get("id")
        data_json = {**data_json, "_recovered": True}
        sub, created = _persist_submission(db, form, data_json, capsule_id)
        results.append({
            "index": i,
            "status": "saved" if created else "duplicate",
            "id": str(sub.id),
            "serial_no": sub.serial_no,
        })

    saved = sum(1 for r in results if r["status"] == "saved")
    return {"saved": saved, "total": len(results), "results": results}


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
