"""MediaFile — tracks uploaded photos/audio per submission field.

Each photo/audio field in a submission gets its own media_file record.
Files stored on local disk (uploads/ directory), cloud_url populated
when migrated to S3/R2 in production.
"""
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.core.database import Base


class MediaFile(Base):
    __tablename__ = "media_files"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    submission_id = Column(UUID(as_uuid=True), ForeignKey("submissions.id", ondelete="CASCADE"))
    field_name = Column(String, nullable=False)          # which form field this belongs to
    file_type = Column(String)                           # 'photo' | 'audio'
    mime_type = Column(String)                           # 'image/jpeg', 'audio/webm', etc.
    cloud_url = Column(String)                           # local path initially, S3 URL later
    file_size_bytes = Column(Integer)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
