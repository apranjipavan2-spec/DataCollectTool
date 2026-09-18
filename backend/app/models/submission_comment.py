import uuid
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base
from app.core.soft_delete import SoftDeleteMixin


class SubmissionComment(Base, SoftDeleteMixin):
    """Threaded review comment between supervisors and enumerators on a submission."""
    __tablename__ = "submission_comments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    submission_id = Column(UUID(as_uuid=True), ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    author_id = Column(UUID(as_uuid=True), nullable=False)
    author_name = Column(String, nullable=False, default="")
    author_role = Column(String, nullable=False, default="")
    body = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
