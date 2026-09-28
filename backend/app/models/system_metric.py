from sqlalchemy import Column, BigInteger, Float, DateTime, func
from app.core.database import Base


class SystemMetric(Base):
    """One per-minute CPU/RAM sample of the app host, taken by the scheduler.
    Pruned to a rolling 7 days (see scheduler._run_system_metrics_sample)."""
    __tablename__ = "system_metrics"

    id           = Column(BigInteger, primary_key=True, autoincrement=True)
    ts           = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    cpu_pct      = Column(Float, nullable=False)
    mem_pct      = Column(Float, nullable=False)
    mem_used_mb  = Column(Float, nullable=False)
    mem_total_mb = Column(Float, nullable=False)
