"""
Web Push notification endpoints.

- POST /subscribe   — save a browser push subscription
- POST /unsubscribe — remove a subscription
- POST /send        — admin sends a push to specific user(s)

Helper `send_push()` is used by other modules (schedules, assignments)
to auto-notify enumerators.
"""
import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from pywebpush import webpush, WebPushException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import require_enumerator, require_supervisor
from app.models.push_subscription import PushSubscription

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class PushKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeRequest(BaseModel):
    endpoint: str
    keys: PushKeys


class SendRequest(BaseModel):
    user_ids: List[str]
    title: str
    body: str
    url: Optional[str] = "/"


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/subscribe")
def subscribe(
    body: SubscribeRequest,
    user=Depends(require_enumerator),
    db: Session = Depends(get_db),
):
    """Save a Web Push subscription for the current user."""
    # Upsert: if same endpoint exists for this user, update keys
    existing = db.query(PushSubscription).filter(
        PushSubscription.user_id == user["sub"],
        PushSubscription.endpoint == body.endpoint,
    ).first()

    if existing:
        existing.p256dh = body.keys.p256dh
        existing.auth = body.keys.auth
    else:
        db.add(PushSubscription(
            tenant_id=user["tenant_id"],
            user_id=user["sub"],
            endpoint=body.endpoint,
            p256dh=body.keys.p256dh,
            auth=body.keys.auth,
        ))

    db.commit()
    return {"status": "subscribed"}


@router.post("/unsubscribe")
def unsubscribe(
    body: SubscribeRequest,
    user=Depends(require_enumerator),
    db: Session = Depends(get_db),
):
    """Remove a push subscription."""
    deleted = db.query(PushSubscription).filter(
        PushSubscription.user_id == user["sub"],
        PushSubscription.endpoint == body.endpoint,
    ).delete()
    db.commit()
    return {"status": "unsubscribed", "removed": deleted}


@router.post("/send")
def send_notification(
    body: SendRequest,
    user=Depends(require_supervisor),
    db: Session = Depends(get_db),
):
    """Admin/supervisor sends a push notification to specific users."""
    results = {"sent": 0, "failed": 0}
    for uid in body.user_ids:
        ok = send_push(db, uid, body.title, body.body, body.url)
        if ok:
            results["sent"] += 1
        else:
            results["failed"] += 1
    return results


# ── Helper (importable by other modules) ─────────────────────────────────────

def send_push(db: Session, user_id: str, title: str, body: str, url: str = "/") -> bool:
    """
    Send a Web Push notification to all subscriptions for a given user.
    Returns True if at least one push was delivered successfully.
    Silently handles missing VAPID keys and expired subscriptions.
    """
    if not settings.VAPID_PRIVATE_KEY or not settings.VAPID_PUBLIC_KEY:
        logger.warning("VAPID keys not configured — skipping push notification")
        return False

    subs = db.query(PushSubscription).filter(
        PushSubscription.user_id == user_id,
    ).all()

    if not subs:
        return False

    payload = json.dumps({
        "title": title,
        "body": body,
        "url": url,
    })

    any_success = False
    stale_ids = []

    for sub in subs:
        subscription_info = {
            "endpoint": sub.endpoint,
            "keys": {
                "p256dh": sub.p256dh,
                "auth": sub.auth,
            },
        }
        try:
            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_CLAIM_EMAIL},
            )
            any_success = True
        except WebPushException as e:
            # 410 Gone or 404 means subscription expired — clean up
            if hasattr(e, "response") and e.response is not None and e.response.status_code in (404, 410):
                stale_ids.append(sub.id)
            else:
                logger.error("Push failed for user %s: %s", user_id, e)
        except Exception as e:
            logger.error("Push failed for user %s: %s", user_id, e)

    # Remove stale subscriptions
    if stale_ids:
        db.query(PushSubscription).filter(PushSubscription.id.in_(stale_ids)).delete(synchronize_session=False)
        db.commit()

    return any_success
