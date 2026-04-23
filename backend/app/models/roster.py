from uuid import uuid4
from sqlalchemy import Column, String, Text, Date, ForeignKey, TIMESTAMP, func
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class RespondentRoster(Base):
    __tablename__ = "respondent_roster"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    form_id = Column(UUID(as_uuid=True), ForeignKey("forms.id"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(String(255), nullable=False)
    phone = Column(String(50))
    address = Column(Text)
    target_enumerator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    status = Column(String(20), default="pending")
    scheduled_date = Column(Date, nullable=True)
    notes = Column(Text)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
