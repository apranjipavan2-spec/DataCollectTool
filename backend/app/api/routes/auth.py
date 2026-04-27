import random, string, secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from app.core.database import get_db
from jose import JWTError, jwt
from app.core.security import (
    hash_otp, verify_otp, hash_password, verify_password,
    create_access_token, create_refresh_token, decode_token,
)
from app.core.config import settings
from app.core.rate_limit import limiter
from app.core.deps import get_current_user, require_org_admin
from app.models.user import User
from app.services.email import send_password_reset_email

router = APIRouter()

OTP_EXPIRE_MINUTES = 10
RESET_TOKEN_EXPIRE_MINUTES = 60


class LoginRequest(BaseModel):
    phone: str
    password: str


class SendOTPRequest(BaseModel):
    phone: str


class VerifyOTPRequest(BaseModel):
    phone: str
    otp: str


class SetPasswordRequest(BaseModel):
    password: str


class ForgotPasswordRequest(BaseModel):
    phone: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


def _generate_otp() -> str:
    return "".join(random.choices(string.digits, k=6))


class RefreshRequest(BaseModel):
    refresh_token: str


def _make_token(user: User) -> dict:
    """Generate access + refresh JWTs and return auth response payload."""
    access = create_access_token({
        "sub": str(user.id),
        "tenant_id": str(user.tenant_id),
        "role": user.role,
        "name": user.name,
        "email": user.email,
    })
    refresh = create_refresh_token(str(user.id))
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "role": user.role,
        "name": user.name,
        "email": user.email,
        "phone": user.phone,
        "id": str(user.id),
    }


# ── Password login (primary for MVP) ─────────────────────────────────────

@router.post("/login")
@limiter.limit("10/minute")
def login(request: Request, body: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate with phone + password."""
    user = db.query(User).filter(User.phone == body.phone, User.is_active == True).first()
    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="Invalid phone or password")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid phone or password")
    return _make_token(user)


# ── Token refresh ────────────────────────────────────────────────────────

@router.post("/refresh")
def refresh(body: RefreshRequest, db: Session = Depends(get_db)):
    """Exchange a valid refresh token for a new access token (+ rotated refresh token)."""
    try:
        payload = decode_token(body.refresh_token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user = db.query(User).filter(User.id == payload["sub"], User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found or deactivated")

    return _make_token(user)


# ── Admin contact lookup (public — for WhatsApp redirect on forgot-password) ─

@router.get("/admin-contact")
@limiter.limit("10/minute")
def admin_contact(request: Request, phone: str, db: Session = Depends(get_db)):
    """Return the org admin's name+phone for a given enumerator/supervisor phone.
    Used by the forgot-password page to pre-fill a WhatsApp message to the right admin.
    Always returns 200 to avoid user enumeration; returns nulls when not found."""
    user = db.query(User).filter(User.phone == phone, User.is_active == True).first()
    if not user:
        return {"name": None, "phone": None}
    admin = (
        db.query(User)
        .filter(User.tenant_id == user.tenant_id, User.role == "org_admin", User.is_active == True)
        .first()
    )
    if not admin:
        return {"name": None, "phone": None, "qr_login_enabled": False}
    from app.models.tenant import Tenant
    tenant = db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
    qr_enabled = bool((tenant.notification_config or {}).get("qr_login_enabled", False)) if tenant else False
    return {"name": admin.name or "Admin", "phone": admin.phone, "qr_login_enabled": qr_enabled}


# ── Set / change password ─────────────────────────────────────────────────

# ── Forgot / reset password ──────────────────────────────────────────────

@router.post("/forgot-password")
@limiter.limit("5/minute")
def forgot_password(request: Request, body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Generate a password-reset token and email it to the user (if email exists)."""
    # Always return success to avoid user enumeration
    user = db.query(User).filter(User.phone == body.phone, User.is_active == True).first()
    if not user:
        return {"message": "If an account exists, a reset link has been sent."}

    # Generate a secure random token, store its hash using the OTP fields
    raw_token = secrets.token_urlsafe(32)
    user.otp_hash = hash_otp(raw_token)
    user.otp_expires_at = datetime.now(timezone.utc) + timedelta(minutes=RESET_TOKEN_EXPIRE_MINUTES)
    db.commit()

    # Send email if user has an email address
    if user.email:
        send_password_reset_email(user.email, user.name or "User", raw_token)
    # No SMS gateway configured — admin can reset password manually from user management

    return {"message": "If an account exists, a reset link has been sent."}


@router.post("/reset-password")
@limiter.limit("10/minute")
def reset_password(request: Request, body: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Validate reset token and set a new password."""
    if len(body.new_password) < 6:
        raise HTTPException(status_code=422, detail="Password must be at least 6 characters")

    # Find user with a valid (non-expired) reset token
    users_with_tokens = db.query(User).filter(
        User.otp_hash.isnot(None),
        User.otp_expires_at.isnot(None),
        User.is_active == True,
    ).all()

    matched_user = None
    for u in users_with_tokens:
        if u.otp_expires_at and datetime.now(timezone.utc) > u.otp_expires_at:
            continue
        if verify_otp(body.token, u.otp_hash):
            matched_user = u
            break

    if not matched_user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    matched_user.password_hash = hash_password(body.new_password)
    matched_user.otp_hash = None
    matched_user.otp_expires_at = None
    db.commit()

    return {"message": "Password has been reset successfully."}


# ── Change password (authenticated) ─────────────────────────────────────

@router.post("/change-password")
def change_password(body: ChangePasswordRequest, user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Change password for the currently authenticated user."""
    if len(body.new_password) < 6:
        raise HTTPException(status_code=422, detail="Password must be at least 6 characters")

    db_user = db.query(User).filter(User.id == user["sub"]).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    if not db_user.password_hash or not verify_password(body.current_password, db_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    db_user.password_hash = hash_password(body.new_password)
    db.commit()

    return {"message": "Password changed successfully."}


# ── Legacy set-password stub (deprecated) ────────────────────────────────

@router.post("/set-password")
def set_password(body: SetPasswordRequest, db: Session = Depends(get_db)):
    """Deprecated — use /change-password or /reset-password instead."""
    raise HTTPException(status_code=410, detail="Use /auth/change-password or /auth/forgot-password")


# ── OTP login (kept as fallback / future 2FA) ────────────────────────────

@router.post("/send-otp")
@limiter.limit("5/minute")
def send_otp(request: Request, body: SendOTPRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.phone == body.phone, User.is_active == True).first()
    if not user:
        return {"message": "OTP sent if phone is registered"}

    otp = _generate_otp()
    user.otp_hash = hash_otp(otp)
    user.otp_expires_at = datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRE_MINUTES)
    db.commit()

    # SMS gateway not yet integrated — OTP login is available for future 2FA

    return {"message": "OTP sent if phone is registered"}


class QrGenerateRequest(BaseModel):
    user_id: str


class QrLoginRequest(BaseModel):
    token: str


@router.post("/qr-generate")
def qr_generate(body: QrGenerateRequest, current_user=Depends(require_org_admin), db: Session = Depends(get_db)):
    from app.models.tenant import Tenant
    tenant = db.query(Tenant).filter(Tenant.id == current_user["tenant_id"]).first()
    if not tenant or not (tenant.notification_config or {}).get("qr_login_enabled", False):
        raise HTTPException(status_code=403, detail="QR login is not enabled for this organisation. Enable it in Settings → Security.")
    target = db.query(User).filter(User.id == body.user_id, User.is_active == True).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    expire = datetime.now(timezone.utc) + timedelta(seconds=86400)
    payload = {"sub": str(target.id), "purpose": "qr_login", "exp": expire}
    token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    qr_url = f"/auth/qr-login?t={token}"
    return {"token": token, "qr_url": qr_url}


@router.post("/qr-login")
def qr_login(body: QrLoginRequest, db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(body.token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired QR token")
    if payload.get("purpose") != "qr_login":
        raise HTTPException(status_code=401, detail="Invalid token purpose")
    user = db.query(User).filter(User.id == payload["sub"], User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found or deactivated")
    return _make_token(user)


@router.post("/verify-otp")
@limiter.limit("10/minute")
def verify_otp_route(request: Request, body: VerifyOTPRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.phone == body.phone, User.is_active == True).first()
    invalid = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired OTP")

    if not user or not user.otp_hash or not user.otp_expires_at:
        raise invalid
    if datetime.now(timezone.utc) > user.otp_expires_at:
        raise invalid
    if not verify_otp(body.otp, user.otp_hash):
        raise invalid

    # Invalidate after use
    user.otp_hash = None
    user.otp_expires_at = None
    db.commit()

    return _make_token(user)
