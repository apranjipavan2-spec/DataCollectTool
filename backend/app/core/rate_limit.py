"""
In-memory rate limiting for FieldGovern API (no Redis required).

Uses slowapi with the default in-memory backend.  Suitable for
single-process / MVP deployments.  Swap to a Redis backend later
by changing `storage_uri` to settings.REDIS_URL.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

# Key function: rate-limit by client IP address
limiter = Limiter(key_func=get_remote_address, default_limits=[])
