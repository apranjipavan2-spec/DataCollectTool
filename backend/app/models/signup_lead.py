from sqlalchemy import Column, BigInteger, String, DateTime, Integer, Text, func
from app.core.database import Base


class SignupLead(Base):
    """Platform-level (no tenant) record of everyone who showed interest: chatbot
    captures and signup attempts. One row per email; status never downgrades from
    'registered'."""
    __tablename__ = "signup_leads"

    id           = Column(BigInteger, primary_key=True, autoincrement=True)
    email        = Column(String(320), nullable=False, unique=True)
    phone        = Column(String(32), nullable=True)
    name         = Column(String(200), nullable=True)
    org_name     = Column(String(200), nullable=True)
    source       = Column(String(32), nullable=False)       # website_chat | login_chat | signup_form
    status       = Column(String(16), nullable=False, default="lead")  # lead | attempted | registered
    attempts     = Column(Integer, nullable=False, default=1)
    note         = Column(Text, nullable=True)               # last failure reason / chat message
    ip           = Column(String(64), nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    last_seen_at = Column(DateTime(timezone=True), server_default=func.now())
