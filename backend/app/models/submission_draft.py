from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid
from app.core.database import Base


class SubmissionDraft(Base):
    """A half-filled form saved server-side when the enumerator taps Save & Exit.

    Deliberately kept in its own table (not `submissions`) so drafts never leak
    into submission counts, plan quota, dashboards, duplicate detection, or
    webhooks. One row per (enumerator, local_id); the client's draft UUID is the
    upsert key. Promoted/deleted when the response is finally synced.
    """
    __tablename__ = "submission_drafts"
    __table_args__ = (UniqueConstraint("enumerator_id", "local_id", name="uq_draft_enum_local"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    enumerator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    form_id = Column(UUID(as_uuid=True), ForeignKey("forms.id"), nullable=False)
    form_version = Column(Integer)
    local_id = Column(String, nullable=False)   # client draft UUID
    data_json = Column(JSONB, nullable=False)
    gps_open = Column(JSONB)
    gps_submit = Column(JSONB)
    local_created_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
