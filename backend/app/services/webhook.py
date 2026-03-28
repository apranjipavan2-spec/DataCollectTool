import logging
import hashlib
import hmac
import json
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session
from app.models.webhook import Webhook

logger = logging.getLogger(__name__)


def fire_webhooks(db: Session, tenant_id: str, event: str, payload: dict) -> int:
    """Fire all active webhooks for the given tenant and event.
    Returns number of successful deliveries.
    Never raises — webhook failures must not block the API response."""
    try:
        hooks = db.query(Webhook).filter(
            Webhook.tenant_id == tenant_id,
            Webhook.is_active == True,
        ).all()
    except Exception as e:
        logger.warning("[Webhook] Failed to query webhooks: %s", e)
        return 0

    fired = 0
    for hook in hooks:
        # Check if this hook subscribes to this event
        if hook.events and event not in hook.events:
            continue

        try:
            headers = dict(hook.headers or {})
            headers["Content-Type"] = "application/json"
            headers["X-FieldPulse-Event"] = event
            headers["X-FieldPulse-Timestamp"] = datetime.now(timezone.utc).isoformat()

            body = json.dumps(payload, default=str)

            # HMAC signature if secret is configured
            if hook.secret:
                sig = hmac.new(hook.secret.encode(), body.encode(), hashlib.sha256).hexdigest()
                headers["X-FieldPulse-Signature"] = f"sha256={sig}"

            with httpx.Client(timeout=10.0) as client:
                resp = client.post(hook.url, content=body, headers=headers)
                resp.raise_for_status()

            fired += 1
            logger.info("[Webhook] %s -> %s (%d)", event, hook.url, resp.status_code)
        except Exception as e:
            logger.warning("[Webhook] Failed %s -> %s: %s", event, hook.url, e)

    return fired
