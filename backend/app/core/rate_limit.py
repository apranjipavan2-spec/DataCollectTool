"""
Rate limiting for FieldGovern API.

Uses Redis backend when available (production), falls back to in-memory
for local dev or when Redis is unreachable. Redis backend ensures rate
limits persist across app restarts and work correctly with multiple workers.
"""

import logging
from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

logger = logging.getLogger(__name__)


def _rate_limit_key(request: Request) -> str:
    """Key limits by authenticated user when possible, else by client IP.

    Field teams routinely share one public IP — office Wi-Fi, a mobile hotspot,
    or carrier-grade NAT that puts many phones behind a single address. Keying
    authenticated endpoints per-user means one enumerator's syncing never eats a
    teammate's quota, which is what caused legitimate collection to hit
    "rate limit exceeded". Anonymous endpoints (login, public survey) still key
    by IP. Expiry is intentionally ignored here — this is bucketing, not auth;
    the route's own dependency still enforces a valid, unexpired token.
    """
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        try:
            from jose import jwt
            from app.core.config import settings
            payload = jwt.decode(
                auth[7:], settings.JWT_SECRET,
                algorithms=[settings.JWT_ALGORITHM],
                options={"verify_exp": False},
            )
            sub = payload.get("sub")
            if sub:
                return f"user:{sub}"
        except Exception:
            pass
    return get_remote_address(request)


def _build_limiter() -> Limiter:
    try:
        from app.core.config import settings
        import redis as _redis
        r = _redis.from_url(settings.REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
        r.ping()
        logger.info("Rate limiter: using Redis backend at %s", settings.REDIS_URL)
        return Limiter(
            key_func=_rate_limit_key,
            default_limits=[],
            storage_uri=settings.REDIS_URL,
        )
    except Exception as e:
        logger.warning("Rate limiter: Redis unavailable (%s), falling back to in-memory", e)
        return Limiter(key_func=_rate_limit_key, default_limits=[])


limiter = _build_limiter()
