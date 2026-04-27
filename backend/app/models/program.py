import uuid
from sqlalchemy import Column, String, Integer, Date, DateTime, Float, ForeignKey, Text, Boolean, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.core.database import Base


class ProgramLocation(Base):
    __tablename__ = "program_locations"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    program_id = Column(UUID(as_uuid=True), ForeignKey("programs.id", ondelete="CASCADE"), nullable=True)
    state = Column(String, default="")
    district = Column(String, nullable=False)
    block = Column(String, default="")
    village = Column(String, default="")
    gps_lat = Column(Float, nullable=True)
    gps_lng = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Program(Base):
    __tablename__ = "programs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    scheme_name = Column(String, default="")
    description = Column(Text, default="")
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    status = Column(String, default="active")  # planning|active|completed|archived
    is_panel_study = Column(Boolean, default=False, nullable=True)
    allow_enumerator_edit = Column(Boolean, nullable=True)  # null = use org default
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ProgramParticipantType(Base):
    __tablename__ = "program_participant_types"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    program_id = Column(UUID(as_uuid=True), ForeignKey("programs.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    sort_order = Column(Integer, default=0)


class ProgramQuestionnaire(Base):
    __tablename__ = "program_questionnaires"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    program_id = Column(UUID(as_uuid=True), ForeignKey("programs.id", ondelete="CASCADE"), nullable=False)
    participant_type_id = Column(UUID(as_uuid=True), ForeignKey("program_participant_types.id", ondelete="SET NULL"), nullable=True)
    form_id = Column(UUID(as_uuid=True), ForeignKey("forms.id", ondelete="SET NULL"), nullable=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    total_target = Column(Integer, default=0)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    status = Column(String, default="active")  # active|completed|cancelled
    wave_number = Column(Integer, nullable=True)   # 1=baseline, 2=midline, 3=endline
    wave_label = Column(String(100), nullable=True)  # "Baseline", "Midline", "Endline"
    panel_key = Column(String(200), nullable=True)   # field_id used as household/respondent ID
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class QuestionnaireLocationTarget(Base):
    __tablename__ = "questionnaire_location_targets"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    questionnaire_id = Column(UUID(as_uuid=True), ForeignKey("program_questionnaires.id", ondelete="CASCADE"), nullable=False)
    location_id = Column(UUID(as_uuid=True), ForeignKey("program_locations.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    target_count = Column(Integer, default=0)
    deadline = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ProgramAnalysis(Base):
    __tablename__ = "program_analysis"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    program_id = Column(UUID(as_uuid=True), ForeignKey("programs.id", ondelete="CASCADE"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    status = Column(Text, default="done")       # pending | done | failed
    source = Column(Text, default="manual")     # manual | ai
    objectives = Column(Text, nullable=True)
    table_configs = Column(JSONB, default=list)
    cleaning_summary = Column(JSONB, default=dict)
    ai_rationale = Column(Text, nullable=True)
    error_text = Column(Text, nullable=True)
    run_count = Column(Integer, default=0)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
