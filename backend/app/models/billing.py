from sqlalchemy import Column, String, DateTime, Boolean, Integer, Float, Text, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid
from app.core.database import Base


class Plan(Base):
    __tablename__ = "plans"

    id             = Column(String, primary_key=True)          # e.g. "ngo_free", "ngo_starter"
    segment        = Column(String, nullable=False)            # ngo | govt | research | corporate
    tier           = Column(String, nullable=False)            # free | starter | growth | enterprise
    name           = Column(String, nullable=False)            # display name
    description    = Column(Text)

    # Pricing (monthly base, before billing-cycle discount)
    price_inr      = Column(Integer, default=0)                # monthly price in INR paise (0 = free)
    price_usd_cents= Column(Integer, default=0)                # monthly price in USD cents

    # Limits (None/null = unlimited)
    submissions_limit   = Column(Integer)                      # per billing period
    storage_limit_mb    = Column(Integer)                      # total
    max_org_admins      = Column(Integer)
    max_supervisors     = Column(Integer)
    max_enumerators     = Column(Integer)
    asr_minutes_limit   = Column(Integer, default=5)
    translation_chars   = Column(Integer, default=3000)

    # Feature flags
    ai_cleaning         = Column(Boolean, default=False)
    ai_writer           = Column(Boolean, default=False)
    ai_smart_builder    = Column(Boolean, default=False)
    ai_interpret        = Column(Boolean, default=False)
    ai_analyzer         = Column(Boolean, default=False)
    map_view            = Column(Boolean, default=False)
    panel_study         = Column(Boolean, default=False)
    spss_export         = Column(Boolean, default=False)
    api_write           = Column(Boolean, default=False)
    webhooks            = Column(Boolean, default=False)
    two_fa              = Column(Boolean, default=False)
    sso                 = Column(Boolean, default=False)
    audit_log           = Column(Boolean, default=False)
    advanced_rbac       = Column(Boolean, default=False)
    white_label         = Column(Boolean, default=False)
    on_premise          = Column(Boolean, default=False)
    priority_support    = Column(Boolean, default=False)

    is_active      = Column(Boolean, default=True)
    sort_order     = Column(Integer, default=0)


class Subscription(Base):
    __tablename__ = "subscriptions"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id        = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, unique=True)
    plan_id          = Column(String, ForeignKey("plans.id"), nullable=False)

    # Billing
    billing_cycle    = Column(String, default="monthly")   # monthly | 6month | annual | 3year
    discount_pct     = Column(Integer, default=0)          # 0 | 10 | 20 | 30
    amount_inr       = Column(Integer, default=0)          # actual charged amount (after discount)

    # Status
    status           = Column(String, default="trialing")  # trialing | active | past_due | cancelled | expired
    trial_start      = Column(DateTime(timezone=True), server_default=func.now())
    trial_end        = Column(DateTime(timezone=True))
    current_period_start = Column(DateTime(timezone=True))
    current_period_end   = Column(DateTime(timezone=True))

    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PaymentRequest(Base):
    __tablename__ = "payment_requests"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_ref        = Column(String, unique=True, nullable=False)   # FG-2026-XXXX (shown to user)
    tenant_id        = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    plan_id          = Column(String, ForeignKey("plans.id"), nullable=False)

    billing_cycle    = Column(String, nullable=False)
    amount_inr       = Column(Integer, nullable=False)               # in paise? No — store in rupees for readability
    discount_pct     = Column(Integer, default=0)

    # User-submitted after payment
    utr_number       = Column(String)                               # UTR / transaction ref from bank
    payment_screenshot_url = Column(String)                         # optional uploaded screenshot

    # Admin action
    status           = Column(String, default="pending")           # pending | confirmed | rejected
    confirmed_by     = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    confirmed_at     = Column(DateTime(timezone=True))
    rejection_reason = Column(Text)

    # Metadata
    notes            = Column(Text)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class UsageRecord(Base):
    __tablename__ = "usage_records"

    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id            = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    period_year          = Column(Integer, nullable=False)
    period_month         = Column(Integer, nullable=False)          # 1-12

    submissions_used     = Column(Integer, default=0)
    storage_used_mb      = Column(Float, default=0.0)
    ai_reports_used      = Column(Integer, default=0)
    ai_cleaning_runs     = Column(Integer, default=0)
    asr_minutes_used     = Column(Float, default=0.0)

    updated_at           = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
