from sqlalchemy import Column, String, DateTime, Boolean, func
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.core.database import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    logo_url = Column(String)
    primary_color = Column(String, default="#2563EB")
    app_name = Column(String, default="")  # white-label app name
    plan_tier = Column(String, default="free")  # free | starter | professional | enterprise
    subscription_status = Column(String, default="active")
    free_submissions_used = Column(String, default=0)
    allow_enumerator_edit = Column(Boolean, default=True, nullable=False, server_default='true')
    created_at = Column(DateTime(timezone=True), server_default=func.now())
