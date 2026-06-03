from sqlalchemy import Column, BigInteger, String, DateTime, Integer, Boolean, Text, func
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class AiUsageLog(Base):
    __tablename__ = "ai_usage_logs"

    id         = Column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id  = Column(UUID(as_uuid=True), nullable=False)
    user_id    = Column(UUID(as_uuid=True), nullable=True)
    feature    = Column(String(64), nullable=False)
    provider   = Column(String(32), nullable=False)
    model      = Column(String(64), nullable=True)
    tokens_in  = Column(Integer, default=0)
    tokens_out = Column(Integer, default=0)
    success    = Column(Boolean, default=True)
    error      = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
