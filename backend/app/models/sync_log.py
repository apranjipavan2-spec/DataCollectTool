from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.core.database import Base


class SyncLog(Base):
    __tablename__ = "sync_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    enumerator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    direction = Column(String)
    records_count = Column(Integer, default=0)
    media_count = Column(Integer, default=0)
    sync_duration_ms = Column(Integer)
    synced_at = Column(DateTime(timezone=True), server_default=func.now())
