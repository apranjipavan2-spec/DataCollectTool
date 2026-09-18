import uuid
from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class InAppNotification(Base):
    """Per-user in-app inbox notification. Separate from WhatsApp/web-push
    (see app/api/routes/notifications.py) — this is the read/unread feed only."""
    __tablename__ = "in_app_notifications"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    recipient_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type = Column(String(50), nullable=False, default="info")
    title = Column(String(200), nullable=False, default="")
    body = Column(Text, nullable=False, default="")
    link = Column(String(500), nullable=False, default="")
    read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
