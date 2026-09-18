import uuid
from sqlalchemy import Column, String, Integer, Float, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.core.database import Base
from app.core.soft_delete import SoftDeleteMixin


class LogframeLevel(Base, SoftDeleteMixin):
    """Goal -> Outcome -> Output -> Activity hierarchy for a program (the results cascade)."""
    __tablename__ = "logframe_levels"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    program_id = Column(UUID(as_uuid=True), ForeignKey("programs.id", ondelete="CASCADE"), nullable=False)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("logframe_levels.id", ondelete="SET NULL"), nullable=True)
    level_type = Column(String(20), nullable=False)  # goal|outcome|output|activity
    title = Column(Text, nullable=False)
    description = Column(Text, default="")
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Indicator(Base, SoftDeleteMixin):
    """A measured indicator attached to one logframe level."""
    __tablename__ = "indicators"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    program_id = Column(UUID(as_uuid=True), ForeignKey("programs.id", ondelete="CASCADE"), nullable=False)
    logframe_level_id = Column(UUID(as_uuid=True), ForeignKey("logframe_levels.id", ondelete="CASCADE"), nullable=False)
    code = Column(String(50), default="")
    name = Column(Text, nullable=False)
    unit = Column(String(20), default="count")          # count|percent|ratio|mean|text
    direction = Column(String(10), default="increase")  # increase|decrease
    disaggregate_by = Column(JSONB, default=list)        # ["sex","age_band"]
    # auto-compute mapping (ignored when value_source=manual)
    source_form_field = Column(String(200), nullable=True)
    aggregation = Column(String(20), default="count")    # count|sum|mean|percent
    numerator_filter = Column(JSONB, nullable=True)      # {"field": "...", "equals": "..."}
    denominator_filter = Column(JSONB, nullable=True)
    value_source = Column(String(10), default="auto")    # auto|manual
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class IndicatorValue(Base):
    """One ITT cell: an indicator's value for one wave (questionnaire) x disaggregation bucket."""
    __tablename__ = "indicator_values"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    indicator_id = Column(UUID(as_uuid=True), ForeignKey("indicators.id", ondelete="CASCADE"), nullable=False)
    questionnaire_id = Column(UUID(as_uuid=True), ForeignKey("program_questionnaires.id", ondelete="CASCADE"), nullable=False)
    disaggregation = Column(JSONB, default=dict)  # {} = total row, else e.g. {"sex": "F"}
    target_value = Column(Float, nullable=True)
    actual_value = Column(Float, nullable=True)
    numerator = Column(Float, nullable=True)
    denominator = Column(Float, nullable=True)
    value_source = Column(String(10), default="auto")  # auto|manual
    note = Column(Text, nullable=True)
    computed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
