from datetime import datetime, timedelta
import bcrypt as _bcrypt
from jose import JWTError, jwt
from app.core.config import settings


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    # JWT_EXPIRE_MINUTES <= 0 → non-expiring access token (session ends only on
    # explicit logout). Omitting `exp` means jose never raises on expiry.
    if settings.JWT_EXPIRE_MINUTES > 0:
        expire = datetime.utcnow() + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
        to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    """Long-lived signed JWT (30 days) used only to obtain a new access token."""
    expire = datetime.utcnow() + timedelta(days=30)
    payload = {"sub": user_id, "type": "refresh", "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])


def hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt(12)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


# API Key helpers
def hash_api_key(api_key: str) -> str:
    """Hash an API key for secure storage."""
    return hash_password(api_key)


def verify_api_key(plain: str, hashed: str) -> bool:
    """Verify an API key against its hash."""
    return verify_password(plain, hashed)


# Legacy OTP helpers (kept for future 2FA)
def hash_otp(otp: str) -> str:
    return hash_password(otp)


def verify_otp(plain: str, hashed: str) -> bool:
    return verify_password(plain, hashed)
