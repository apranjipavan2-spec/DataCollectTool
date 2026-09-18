"""
TOTP-based 2FA for FieldGovern.

Flow:
  Setup:  POST /2fa/setup   → returns provisioning URI + QR data URL
          POST /2fa/verify  → confirms first-time code, enables 2FA on the account
  Login:  Existing /auth/login returns {requires_2fa: true, temp_token: "..."}
          POST /2fa/confirm → validates TOTP code + temp_token, returns full JWT pair
  Disable: POST /2fa/disable → requires current TOTP code to turn off 2FA
"""
import io
import base64
import secrets
from datetime import datetime, timedelta, timezone

import pyotp
import qrcode
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import create_access_token, create_refresh_token, decode_token
from app.core.config import settings
from app.models.user import User
from app.models.audit_log import AuditLog

router = APIRouter(prefix="/2fa", tags=["2fa"])

# Temp tokens for mid-login 2FA challenge (in-memory, short-lived)
_PENDING: dict[str, dict] = {}
_PENDING_TTL_SECONDS = 300


def _qr_data_url(uri: str) -> str:
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _write_audit(db: Session, tenant_id, user_id, action: str, ip: str | None = None):
    db.add(AuditLog(
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        resource="user",
        resource_id=str(user_id),
        ip_address=ip,
    ))
    db.commit()


class TOTPCodeIn(BaseModel):
    code: str


class TempTokenIn(BaseModel):
    temp_token: str
    code: str


@router.post("/setup")
def setup_2fa(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Generate a new TOTP secret for the user. Does NOT enable 2FA yet — call /2fa/verify first."""
    db_user = db.query(User).filter(User.id == user["id"]).first()
    if not db_user:
        raise HTTPException(404, "User not found")
    # Always generate a fresh secret on setup (re-setup replaces old secret)
    secret = pyotp.random_base32()
    db_user.totp_secret = secret
    db_user.totp_enabled = False  # not active until verified
    db.commit()
    totp = pyotp.TOTP(secret)
    app_name = settings.APP_URL.split("//")[-1].split("/")[0] or "FieldGovern"
    uri = totp.provisioning_uri(name=db_user.email or db_user.phone, issuer_name="FieldGovern")
    return {
        "secret": secret,
        "qr_data_url": _qr_data_url(uri),
        "provisioning_uri": uri,
        "message": "Scan the QR code in your authenticator app, then call POST /2fa/verify with a valid code to enable 2FA.",
    }


@router.post("/verify")
def verify_and_enable_2fa(
    body: TOTPCodeIn,
    request: Request,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Verify a TOTP code and enable 2FA on the account."""
    db_user = db.query(User).filter(User.id == user["id"]).first()
    if not db_user or not db_user.totp_secret:
        raise HTTPException(400, "Run POST /2fa/setup first")
    totp = pyotp.TOTP(db_user.totp_secret)
    if not totp.verify(body.code, valid_window=1):
        raise HTTPException(400, "Invalid or expired TOTP code")
    db_user.totp_enabled = True
    _write_audit(db, db_user.tenant_id, db_user.id, "2fa_enabled", request.client.host if request.client else None)
    return {"message": "2FA enabled successfully. You will be prompted for a code on future logins."}


@router.post("/disable")
def disable_2fa(
    body: TOTPCodeIn,
    request: Request,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Disable 2FA. Requires a valid current TOTP code as confirmation."""
    db_user = db.query(User).filter(User.id == user["id"]).first()
    if not db_user or not db_user.totp_enabled or not db_user.totp_secret:
        raise HTTPException(400, "2FA is not enabled on this account")
    totp = pyotp.TOTP(db_user.totp_secret)
    if not totp.verify(body.code, valid_window=1):
        raise HTTPException(400, "Invalid TOTP code")
    db_user.totp_enabled = False
    db_user.totp_secret = None
    _write_audit(db, db_user.tenant_id, db_user.id, "2fa_disabled", request.client.host if request.client else None)
    return {"message": "2FA disabled."}


@router.post("/confirm")
def confirm_2fa_login(body: TempTokenIn, db: Session = Depends(get_db)):
    """
    Second step of 2FA login.
    Accepts the temp_token from /auth/login and a TOTP code.
    Returns full access + refresh tokens on success.
    """
    entry = _PENDING.pop(body.temp_token, None)
    if not entry:
        raise HTTPException(401, "Invalid or expired challenge token")
    if datetime.now(timezone.utc) > entry["expires_at"]:
        raise HTTPException(401, "Challenge token expired — please log in again")
    db_user = db.query(User).filter(User.id == entry["user_id"]).first()
    if not db_user or not db_user.totp_secret:
        raise HTTPException(401, "2FA not configured for this account")
    totp = pyotp.TOTP(db_user.totp_secret)
    if not totp.verify(body.code, valid_window=1):
        raise HTTPException(401, "Invalid TOTP code")
    access = create_access_token({
        "sub": str(db_user.id),
        "tenant_id": str(db_user.tenant_id),
        "role": db_user.role,
        "name": db_user.name,
        "email": db_user.email,
    })
    refresh = create_refresh_token(str(db_user.id))
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "role": db_user.role,
        "name": db_user.name,
        "email": db_user.email,
        "phone": db_user.phone,
        "id": str(db_user.id),
    }


def issue_2fa_challenge(user_id: str) -> str:
    """Called by auth routes when a user with 2FA enabled logs in successfully.
    Returns a short-lived temp_token to be included in the 401 response."""
    token = secrets.token_urlsafe(32)
    _PENDING[token] = {
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(seconds=_PENDING_TTL_SECONDS),
    }
    return token
