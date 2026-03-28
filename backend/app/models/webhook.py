from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid
from app.core.database import Base


class Webhook(Base):
    __tablename__ = "webhooks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)          # e.g. "Google Sheets Integration"
    url = Column(String, nullable=False)            # target URL
    secret = Column(String)                         # HMAC signing secret (optional)
    events = Column(JSONB, default=list)            # ["submission.created", "submission.flagged", "submission.approved"]
    headers = Column(JSONB, default=dict)           # custom headers {"Authorization": "Bearer xxx"}
    is_active = Column(Boolean, default=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
