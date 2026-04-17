"""APScheduler setup for FieldPulse.

Runs background jobs inside the FastAPI process — no separate worker needed.
For multi-process deployments (e.g. multiple Uvicorn workers) you'd want
a distributed lock; for MVP single-process this is fine.

Jobs:
  - Daily digest      @ 07:00 UTC every day
"""
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def _run_daily_digest():
    """Called by APScheduler — opens its own DB session."""
    from app.core.database import SessionLocal
    from app.services.digest import send_digest_all_tenants

    logger.info("[Scheduler] Daily digest job starting")
    db = SessionLocal()
    try:
        results = send_digest_all_tenants(db)
        total = sum(r["sent"] for r in results)
        logger.info("[Scheduler] Daily digest done — %d tenants, %d emails sent", len(results), total)
    except Exception:
        logger.exception("[Scheduler] Daily digest job failed")
    finally:
        db.close()


def start_scheduler():
    """Start the background scheduler. Call once on app startup."""
    global _scheduler
    if _scheduler is not None:
        return  # already started

    _scheduler = BackgroundScheduler(timezone="UTC")

    # Daily digest at 07:00 UTC
    _scheduler.add_job(
        _run_daily_digest,
        CronTrigger(hour=7, minute=0),
        id="daily_digest",
        name="Daily Digest Email",
        replace_existing=True,
        misfire_grace_time=3600,  # allow up to 1h late if server was down
    )

    _scheduler.start()
    logger.info("[Scheduler] Started — daily digest scheduled at 07:00 UTC")


def stop_scheduler():
    """Gracefully stop the scheduler. Call on app shutdown."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("[Scheduler] Stopped")
