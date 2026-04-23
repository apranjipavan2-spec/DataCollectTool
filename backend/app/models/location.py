from uuid import uuid4
from sqlalchemy import Column, String, ForeignKey, TIMESTAMP, func
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class Location(Base):
    __tablename__ = 'locations'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey('tenants.id'), nullable=False)
    name = Column(String(255), nullable=False)
    type = Column(String(50), nullable=False)
    parent_id = Column(UUID(as_uuid=True), ForeignKey('locations.id'), nullable=True)
    code = Column(String(100), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
