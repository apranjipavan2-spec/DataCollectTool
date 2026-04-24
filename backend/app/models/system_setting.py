from sqlalchemy import Column, Text, DateTime, func
from sqlalchemy.dialects.postgresql import JSONB
from app.core.database import Base


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key = Column(Text, primary_key=True)
    value = Column(JSONB, nullable=False, default=dict)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
