import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.core.database import Base


class UserToolProject(Base):
    __tablename__ = "user_tool_projects"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id  = Column(UUID(as_uuid=True), ForeignKey("tenants.id",  ondelete="CASCADE"), nullable=False)
    user_id    = Column(UUID(as_uuid=True), ForeignKey("users.id",    ondelete="CASCADE"), nullable=False)
    tool       = Column(String(20),  nullable=False)       # 'analyzer' | 'cleaner'
    name       = Column(String(255), nullable=False)
    program_id = Column(UUID(as_uuid=True), ForeignKey("programs.id", ondelete="SET NULL"), nullable=True)
    data       = Column(JSONB, nullable=False, default=dict, server_default="'{}'::jsonb")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
