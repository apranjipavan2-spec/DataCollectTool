"""
Push subscription model — stores Web Push subscriptions per user.

Each browser/device creates one subscription. A user can have multiple
subscriptions (phone + laptop). Notifications are sent to all active
subscriptions for a given user.
"""
import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.core.database import Base
from app.core.soft_delete import SoftDeleteMixin


class PushSubscription(Base, SoftDeleteMixin):
    __tablename__ = "push_subscriptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # Web Push subscription fields
    endpoint = Column(String, nullable=False)
    p256dh = Column(String, nullable=False)    # public key
    auth = Column(String, nullable=False)      # auth secret

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "endpoint", name="uq_push_sub_user_endpoint"),
    )
