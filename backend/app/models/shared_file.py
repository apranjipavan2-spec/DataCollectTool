"""SharedFile — files uploaded by master_admin and optionally shared with tenants."""
from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, func, Text
from sqlalchemy.dialects.postgresql import UUID, ARRAY
import uuid
from app.core.database import Base


class SharedFile(Base):
    __tablename__ = "shared_files"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    uploaded_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    filename = Column(String, nullable=False)
    original_filename = Column(String, nullable=False)
    mime_type = Column(String)
    file_size_bytes = Column(Integer)
    description = Column(Text, default="")
    disk_path = Column(String, nullable=False)
    shared_with_tenants = Column(ARRAY(UUID(as_uuid=True)), default=[])
    is_global = Column(Boolean, default=False)
    folder = Column(String, default="", server_default="")
    display_name = Column(String, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
