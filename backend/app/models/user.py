from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, func, Text
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    role = Column(String, nullable=False)  # master_admin | org_admin | supervisor | enumerator
    phone = Column(String, nullable=False)
    password_hash = Column(String)              # bcrypt hash — primary auth for MVP
    otp_hash = Column(String)                   # kept for future OTP/2FA
    otp_expires_at = Column(DateTime(timezone=True))
    name = Column(String)
    email = Column(String)  # optional — used for password reset & notifications
    language_pref = Column(String, default="en")  # en | hi | kn | te
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Google OAuth — added in migration 0034
    google_id    = Column(String(255), unique=True, nullable=True)
    auth_provider = Column(String(20), server_default="email")
    avatar_url   = Column(Text, nullable=True)
    # TOTP 2FA — added in migration 0038
    totp_secret  = Column(String(64), nullable=True)
    totp_enabled = Column(Boolean, default=False, server_default='false')
