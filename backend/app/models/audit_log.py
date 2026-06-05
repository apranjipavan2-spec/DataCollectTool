from sqlalchemy import Column, BigInteger, String, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.core.database import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    id          = Column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id   = Column(UUID(as_uuid=True), nullable=False)
    user_id     = Column(UUID(as_uuid=True), nullable=True)
    action      = Column(String(64), nullable=False)
    resource    = Column(String(64), nullable=True)
    resource_id = Column(String(128), nullable=True)
    detail      = Column(JSONB, default=dict, server_default="'{}'::jsonb")
    ip_address  = Column(String(45), nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
