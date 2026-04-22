"""
MSG91 WhatsApp notification service.

Config is stored per-tenant in tenants.notification_config:
{
  "whatsapp_enabled": true,
  "msg91_auth_key": "...",
  "msg91_template_id": "...",
  "notify_events": ["submission.created", "submission.flagged", "import.complete"],
  "notify_numbers": ["+919999990001", "+919876543210"]
}

Events:
  submission.created   — new submission synced from field
  submission.flagged   — supervisor flagged a submission
  submission.approved  — supervisor approved a submission
  submission.rejected  — supervisor rejected a submission
  import.complete      — platform migration import finished

Never raises — notification failures must never block API responses.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_MSG91_URL = "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/"
_TIMEOUT = httpx.Timeout(10.0)

# Human-readable message templates (used when no MSG91 template is configured)
_DEFAULT_MESSAGES: dict[str, str] = {
    "submission.created": "FieldGovern: {count} new submission(s) synced for form '{form_title}' by {enumerator}.",
    "submission.flagged":  "FieldGovern: Submission #{serial} for '{form_title}' has been flagged. Reason: {note}",
    "submission.approved": "FieldGovern: Submission #{serial} for '{form_title}' has been approved.",
    "submission.rejected": "FieldGovern: Submission #{serial} for '{form_title}' has been rejected.",
    "import.complete":     "FieldGovern: Import from {platform} complete — {form_count} form(s), {submission_count} submission(s) imported.",
}


def _get_config(tenant) -> dict:
    cfg = tenant.notification_config or {}
    if isinstance(cfg, str):
        import json
        try: cfg = json.loads(cfg)
        except Exception: cfg = {}
    return cfg


def _should_notify(cfg: dict, event: str) -> bool:
    if not cfg.get("whatsapp_enabled"):
        return False
    if not cfg.get("msg91_auth_key") and not cfg.get("msg91_template_id"):
        return False
    allowed = cfg.get("notify_events", list(_DEFAULT_MESSAGES.keys()))
    return event in allowed


def _build_message(event: str, params: dict) -> str:
    template = _DEFAULT_MESSAGES.get(event, "FieldGovern notification: {event}")
    try:
        return template.format(event=event, **params)
    except KeyError:
        return template.format_map({**params, **{k: '' for k in ['count','form_title','enumerator','serial','note','platform','form_count','submission_count']}})


async def _send_msg91(auth_key: str, template_id: str, numbers: list[str], variables: list[str]) -> bool:
    payload = {
        "integrated_number": "FieldGovern",
        "content_type": "template",
        "payload": {
            "to": [{"mobiles": n.lstrip("+")} for n in numbers],
            "type": "text",
            "template_id": template_id,
            "body": {"variables": variables},
        }
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.post(_MSG91_URL, json=payload, headers={"Authkey": auth_key})
        r.raise_for_status()
    return True


def notify(tenant, event: str, params: dict[str, Any]) -> None:
    """
    Fire WhatsApp notification synchronously (wraps async in a best-effort way).
    Call from sync FastAPI routes using asyncio.create_task or background tasks.
    """
    import asyncio
    cfg = _get_config(tenant)
    if not _should_notify(cfg, event):
        return
    numbers = cfg.get("notify_numbers", [])
    if not numbers:
        return

    auth_key = cfg.get("msg91_auth_key", "")
    template_id = cfg.get("msg91_template_id", "")
    message = _build_message(event, params)
    variables = [message]

    async def _fire():
        try:
            await _send_msg91(auth_key, template_id, numbers, variables)
            logger.info("[WhatsApp] Sent event=%s to %d number(s)", event, len(numbers))
        except Exception as e:
            logger.warning("[WhatsApp] Failed to send event=%s: %s", event, e)

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(_fire())
        else:
            loop.run_until_complete(_fire())
    except Exception as e:
        logger.warning("[WhatsApp] Could not schedule notification: %s", e)
