from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid
from app.core.database import Base


class Submission(Base):
    __tablename__ = "submissions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    form_id = Column(UUID(as_uuid=True), ForeignKey("forms.id"), nullable=False)
    form_version = Column(Integer)  # matches migration 0001: sa.Integer
    schedule_id = Column(UUID(as_uuid=True))
    enumerator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    local_id = Column(String, index=True)      # client UUID for idempotent sync
    data_json = Column(JSONB, nullable=False)
    gps_open = Column(JSONB)   # {"lat": ..., "lng": ..., "accuracy": ...}
    gps_submit = Column(JSONB)
    status = Column(String, default="synced")  # draft | final | synced | flagged
    flag_note = Column(String)                  # reason for flagging (set by supervisor)
    local_created_at = Column(DateTime(timezone=True))
    server_received_at = Column(DateTime(timezone=True), server_default=func.now())
    serial_no = Column(Integer, nullable=True)   # auto-assigned on sync; only master_admin can change
    # Program tracking (set on sync when enumerator collects under a program)
    program_id = Column(UUID(as_uuid=True), nullable=True)
    participant_type_id = Column(UUID(as_uuid=True), nullable=True)
    questionnaire_id = Column(UUID(as_uuid=True), nullable=True)
    location_id = Column(UUID(as_uuid=True), nullable=True)
    # QC / compliance (migration 0020)
    has_violations = Column(Boolean, default=False, nullable=True)
    consent_given = Column(Boolean, default=True, nullable=True)
    consent_timestamp = Column(DateTime(timezone=True), nullable=True)
    backcheck_required = Column(Boolean, default=False, nullable=True)
    backcheck_form_id = Column(UUID(as_uuid=True), nullable=True)
    backcheck_completed = Column(Boolean, default=False, nullable=True)
    roster_id = Column(UUID(as_uuid=True), ForeignKey('respondent_roster.id'), nullable=True)
    household_id = Column(String(500), nullable=True)   # panel study respondent key
