"""
Rate limiting for FieldGovern API.

Uses Redis backend when available (production), falls back to in-memory
for local dev or when Redis is unreachable. Redis backend ensures rate
limits persist across app restarts and work correctly with multiple workers.
"""

import logging
from slowapi import Limiter
from slowapi.util import get_remote_address

logger = logging.getLogger(__name__)


def _build_limiter() -> Limiter:
    try:
        from app.core.config import settings
        import redis as _redis
        r = _redis.from_url(settings.REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
        r.ping()
        logger.info("Rate limiter: using Redis backend at %s", settings.REDIS_URL)
        return Limiter(
            key_func=get_remote_address,
            default_limits=[],
            storage_uri=settings.REDIS_URL,
        )
    except Exception as e:
        logger.warning("Rate limiter: Redis unavailable (%s), falling back to in-memory", e)
        return Limiter(key_func=get_remote_address, default_limits=[])


limiter = _build_limiter()
