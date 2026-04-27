from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid
from app.core.database import Base


class Form(Base):
    __tablename__ = "forms"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    title = Column(String, nullable=False)
    json_schema = Column(JSONB, nullable=False)
    version = Column(Integer, default=1, nullable=False)
    status = Column(String, default="draft")  # draft | active | archived
    is_template = Column(Boolean, default=False)
    # sheets_sync_config: {enabled, apps_script_url, include_metadata}
    sheets_sync_config = Column(JSONB, default=dict, server_default="'{}'::jsonb")
    public_token = Column(String(64), unique=True, nullable=True)
    is_public = Column(Boolean, default=False, server_default='false')
    allow_enumerator_edit = Column(Boolean, nullable=True)  # null = use org default
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
