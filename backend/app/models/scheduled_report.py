import uuid
from sqlalchemy import Column, String, Boolean, JSON, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class ScheduledReport(Base):
    __tablename__ = "scheduled_reports"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id  = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    name       = Column(String, nullable=False)
    program_id = Column(UUID(as_uuid=True), ForeignKey("programs.id"), nullable=True)
    style      = Column(String, default="field_survey")
    custom_context = Column(String, default="")

    # Frequency: "daily", "weekly", "monthly"
    frequency  = Column(String, nullable=False, default="weekly")
    # Hour (UTC) to send: 0-23
    send_hour  = Column(String, nullable=False, default="7")
    # For weekly: 0=Mon … 6=Sun
    send_dow   = Column(String, nullable=True)

    recipient_emails = Column(JSON, nullable=False, default=list)
    is_active  = Column(Boolean, nullable=False, default=True)

    last_sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    updated_at   = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
