from sqlalchemy import Column, String, DateTime, Boolean, Numeric, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid
from app.core.database import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    logo_url = Column(String)
    primary_color = Column(String, default="#2563EB")
    app_name = Column(String, default="")  # white-label app name
    plan_tier = Column(String, default="free")  # free | starter | growth | pro | custom  (legacy: professional, enterprise)
    subscription_status = Column(String, default="active")
    free_submissions_used = Column(String, default=0)
    allow_enumerator_edit = Column(Boolean, default=True, nullable=False, server_default='true')
    # notification_config: {whatsapp_enabled, msg91_auth_key, msg91_template_id,
    #                        notify_events, notify_numbers, sheets_webhook_url}
    notification_config = Column(JSONB, default=dict, server_default="'{}'::jsonb")
    ai_config = Column(JSONB, default=dict, server_default="'{}'::jsonb")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Reseller / partner program (migration 0037)
    reseller_code = Column(String(32), unique=True, nullable=True)
    referred_by_reseller_code = Column(String(32), nullable=True)
    commission_rate = Column(Numeric(5, 2), default=20.00)
    is_reseller = Column(Boolean, default=False, server_default='false')
