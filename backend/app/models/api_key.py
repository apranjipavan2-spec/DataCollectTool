"""
API Key model for service-to-service authentication.

Org admins generate API keys for programmatic access (data export, form queries).
Keys are stored as bcrypt hashes (never plaintext).
Each key inherits the creator's role and tenant.
"""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Index, func
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    name = Column(String, nullable=False)  # e.g., "Analytics Integration", "Mobile App"
    key_hash = Column(String, nullable=False)  # bcrypt hash of the actual key

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)  # Track usage for security
    is_active = Column(Boolean, default=True, nullable=False, index=True)

    __table_args__ = (
        Index("ix_apikey_tenant_active", "tenant_id", "is_active"),
    )

    def __repr__(self) -> str:
        return f"<ApiKey {self.name} (tenant={self.tenant_id}, active={self.is_active})>"
