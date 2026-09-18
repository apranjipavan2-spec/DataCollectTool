import json
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, HttpUrl
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_org_admin
from app.models.webhook import Webhook
from app.core.soft_delete import soft_delete
from app.services.webhook import fire_webhooks

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────

class WebhookCreate(BaseModel):
    name: str
    url: str
    secret: Optional[str] = None
    events: list[str] = []
    headers: dict[str, str] = {}
    is_active: bool = True


class WebhookUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    secret: Optional[str] = None
    events: Optional[list[str]] = None
    headers: Optional[dict[str, str]] = None
    is_active: Optional[bool] = None


VALID_EVENTS = {
    "submission.created",
    "submission.synced",
    "submission.flagged",
    "submission.approved",
    "submission.rejected",
}


def _serialize(hook: Webhook) -> dict:
    return {
        "id": str(hook.id),
        "tenant_id": str(hook.tenant_id),
        "name": hook.name,
        "url": hook.url,
        "secret": "***" if hook.secret else None,
        "events": hook.events or [],
        "headers": {k: "***" for k in (hook.headers or {})},  # mask header values
        "is_active": hook.is_active,
        "created_by": str(hook.created_by) if hook.created_by else None,
        "created_at": hook.created_at.isoformat() if hook.created_at else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────

@router.get("/")
def list_webhooks(user=Depends(require_org_admin), db: Session = Depends(get_db)):
    """List all webhooks for the tenant."""
    hooks = db.query(Webhook).filter(
        Webhook.tenant_id == user["tenant_id"]
    ).order_by(Webhook.created_at.desc()).all()
    return {"items": [_serialize(h) for h in hooks]}


@router.post("/", status_code=201)
def create_webhook(body: WebhookCreate, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    """Create a new webhook."""
    # Validate events
    invalid = set(body.events) - VALID_EVENTS
    if invalid:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid events: {', '.join(sorted(invalid))}. Valid: {', '.join(sorted(VALID_EVENTS))}",
        )

    hook = Webhook(
        tenant_id=user["tenant_id"],
        name=body.name,
        url=body.url,
        secret=body.secret,
        events=body.events,
        headers=body.headers,
        is_active=body.is_active,
        created_by=user.get("sub"),
    )
    db.add(hook)
    db.commit()
    db.refresh(hook)
    return _serialize(hook)


@router.put("/{webhook_id}")
def update_webhook(webhook_id: str, body: WebhookUpdate, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    """Update an existing webhook."""
    hook = db.query(Webhook).filter(
        Webhook.id == webhook_id, Webhook.tenant_id == user["tenant_id"]
    ).first()
    if not hook:
        raise HTTPException(status_code=404, detail="Webhook not found")

    if body.events is not None:
        invalid = set(body.events) - VALID_EVENTS
        if invalid:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid events: {', '.join(sorted(invalid))}. Valid: {', '.join(sorted(VALID_EVENTS))}",
            )

    if body.name is not None:
        hook.name = body.name
    if body.url is not None:
        hook.url = body.url
    if body.secret is not None:
        hook.secret = body.secret
    if body.events is not None:
        hook.events = body.events
    if body.headers is not None:
        hook.headers = body.headers
    if body.is_active is not None:
        hook.is_active = body.is_active

    db.commit()
    db.refresh(hook)
    return _serialize(hook)


@router.delete("/{webhook_id}")
def delete_webhook(webhook_id: str, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    """Delete a webhook."""
    hook = db.query(Webhook).filter(
        Webhook.id == webhook_id, Webhook.tenant_id == user["tenant_id"]
    ).first()
    if not hook:
        raise HTTPException(status_code=404, detail="Webhook not found")

    soft_delete(hook)
    db.commit()
    return {"detail": "Webhook deleted"}


@router.post("/{webhook_id}/test")
def test_webhook(webhook_id: str, user=Depends(require_org_admin), db: Session = Depends(get_db)):
    """Send a test payload to the webhook."""
    hook = db.query(Webhook).filter(
        Webhook.id == webhook_id, Webhook.tenant_id == user["tenant_id"]
    ).first()
    if not hook:
        raise HTTPException(status_code=404, detail="Webhook not found")

    test_payload = {
        "submission_id": "00000000-0000-0000-0000-000000000000",
        "form_id": "00000000-0000-0000-0000-000000000000",
        "enumerator_id": "00000000-0000-0000-0000-000000000000",
        "data_json": {"_test": True, "sample_field": "Hello from FieldGovern!"},
        "status": "synced",
    }

    import httpx
    import hmac
    import hashlib

    headers = dict(hook.headers or {})
    headers["Content-Type"] = "application/json"
    headers["X-FieldGovern-Event"] = "webhook.test"
    headers["X-FieldGovern-Timestamp"] = datetime.now(timezone.utc).isoformat()

    body = json.dumps(test_payload, default=str)

    if hook.secret:
        sig = hmac.new(hook.secret.encode(), body.encode(), hashlib.sha256).hexdigest()
        headers["X-FieldGovern-Signature"] = f"sha256={sig}"

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(hook.url, content=body, headers=headers)
        return {
            "status_code": resp.status_code,
            "success": resp.is_success,
            "response_body": resp.text[:500],
        }
    except Exception as e:
        return {
            "status_code": None,
            "success": False,
            "error": str(e),
        }
