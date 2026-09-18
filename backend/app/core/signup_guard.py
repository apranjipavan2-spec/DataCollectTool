"""Spam/abuse guards for self-serve signup.

Both checks are graceful: if TURNSTILE_SECRET is unset the CAPTCHA check is
skipped (dev), mirroring how email.py skips when SMTP is unconfigured.
"""
import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

# Common disposable / throwaway email domains. Not exhaustive — blocks the
# high-volume ones. Extend as abuse patterns emerge.
_DISPOSABLE_DOMAINS = {
    "mailinator.com", "tempmail.com", "temp-mail.org", "guerrillamail.com",
    "10minutemail.com", "trashmail.com", "yopmail.com", "throwawaymail.com",
    "getnada.com", "dispostable.com", "maildrop.cc", "fakeinbox.com",
    "sharklasers.com", "grr.la", "mailnesia.com", "mohmal.com", "emailondeck.com",
}


def is_disposable_email(email: str) -> bool:
    domain = email.rsplit("@", 1)[-1].strip().lower()
    return domain in _DISPOSABLE_DOMAINS


def verify_turnstile(token: str | None, remote_ip: str | None = None) -> bool:
    """Return True if the Turnstile token is valid (or verification is disabled)."""
    if not settings.TURNSTILE_SECRET:
        return True  # not configured — skip (dev)
    if not token:
        return False
    try:
        data = {"secret": settings.TURNSTILE_SECRET, "response": token}
        if remote_ip:
            data["remoteip"] = remote_ip
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(_TURNSTILE_VERIFY_URL, data=data)
        return bool(resp.json().get("success"))
    except Exception:
        logger.exception("[signup_guard] Turnstile verification error")
        return False
