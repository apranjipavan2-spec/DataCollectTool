"""
Schedule model for planned data collection activities.

Supervisors/admins create schedules that assign forms to enumerators
with a target date range, collection target, and location.
Enumerators see their upcoming schedules on the Collect screen.
"""
import uuid
from sqlalchemy import Column, String, Integer, Date, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.core.database import Base


class Schedule(Base):
    __tablename__ = "schedules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)

    # What to collect
    form_id = Column(UUID(as_uuid=True), ForeignKey("forms.id", ondelete="CASCADE"), nullable=False)

    # Who collects
    enumerator_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # When
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)

    # Where (free text — village/ward/block name)
    location = Column(String, default="")

    # Target
    target_count = Column(Integer, default=0)  # target number of submissions

    # Notes from supervisor
    notes = Column(Text, default="")

    # Status
    status = Column(String, default="upcoming")  # upcoming, active, completed, cancelled
    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
