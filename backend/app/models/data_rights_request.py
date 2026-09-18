import uuid
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, func, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.core.database import Base
from app.core.soft_delete import SoftDeleteMixin


class DataRightsRequest(Base, SoftDeleteMixin):
    """A DPDP data-principal rights request (access / correction / erasure /
    portability), logged by staff on the respondent's behalf — respondents
    don't have accounts in this app, so this is a case-tracking record, not
    a self-serve portal. sla_due_at is computed at creation (created_at + 30
    days, the Rules' aim; 90 days is the outer limit, checked in the API
    layer rather than stored twice)."""
    __tablename__ = "data_rights_requests"

    id        = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    logged_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    request_type = Column(String, nullable=False)   # access | correction | erasure | portability
    requester_name    = Column(String, nullable=False)
    requester_contact = Column(String, nullable=False)   # phone or email — also the search query

    # Optional: nominee acting on the respondent's behalf (incapacity/death)
    nominee_name    = Column(String, nullable=True)
    nominee_contact = Column(String, nullable=True)

    status = Column(String, nullable=False, default="open")   # open | verifying | in_progress | closed
    identity_verified = Column(Boolean, nullable=False, default=False)

    # Submission ids this request was found to cover, populated by the search
    # step and/or manually curated by staff — JSONB array of string UUIDs.
    linked_submission_ids = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))

    resolution_note = Column(String, nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    closed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    sla_due_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
