"""APScheduler setup for FieldGovern.

Runs background jobs inside the FastAPI process — no separate worker needed.
For multi-process deployments (e.g. multiple Uvicorn workers) you'd want
a distributed lock; for MVP single-process this is fine.

Jobs:
  - Daily digest          @ 07:00 UTC every day
  - Monthly usage reset   @ 00:30 UTC on the 1st of each month
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


def _run_scheduled_reports():
    """Check and deliver any scheduled reports that are due now."""
    from app.core.database import SessionLocal
    from app.services.scheduled_reports import run_scheduled_reports

    logger.info("[Scheduler] Scheduled reports check starting")
    db = SessionLocal()
    try:
        result = run_scheduled_reports(db)
        logger.info("[Scheduler] Scheduled reports done — sent=%d skipped=%d errors=%d",
                    result["sent"], result["skipped"], result["errors"])
    except Exception:
        logger.exception("[Scheduler] Scheduled reports job failed")
    finally:
        db.close()


def _run_monthly_usage_reset():
    """Reset per-org monthly usage counters on the 1st of each month."""
    from app.core.database import SessionLocal
    from app.models.billing import UsageRecord
    from datetime import datetime, timezone

    logger.info("[Scheduler] Monthly usage reset starting")
    db = SessionLocal()
    try:
        now   = datetime.now(timezone.utc)
        # Keep the previous month's rows for history; just zero out any that
        # were created for the NEW month already (shouldn't exist yet, but safe).
        # The reset means new submissions this month start fresh — existing
        # UsageRecords for the current month are left alone (created on first use).
        # The key mechanism: check_submission_limit always queries the CURRENT
        # period_year/period_month row, so a new month means a new row = zero usage.
        # This job simply deletes stale rows older than 13 months to keep the table clean.
        from sqlalchemy import and_
        cutoff_year  = now.year - 1
        cutoff_month = now.month  # same month last year
        deleted = db.query(UsageRecord).filter(
            (UsageRecord.period_year < cutoff_year) |
            (
                (UsageRecord.period_year == cutoff_year) &
                (UsageRecord.period_month < cutoff_month)
            )
        ).delete(synchronize_session=False)
        db.commit()
        logger.info("[Scheduler] Monthly reset done — %d old usage rows purged", deleted)
    except Exception:
        logger.exception("[Scheduler] Monthly usage reset failed")
    finally:
        db.close()


def _run_bin_purge():
    """Hard-delete recycle-bin items past the 360-day retention window."""
    from app.api.routes.bin import purge_expired
    logger.info("[Scheduler] Recycle-bin purge starting")
    try:
        purged = purge_expired()
        logger.info("[Scheduler] Recycle-bin purge done — %d items removed", purged)
    except Exception:
        logger.exception("[Scheduler] Recycle-bin purge failed")


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
        misfire_grace_time=3600,
    )

    # Monthly usage purge on 1st of each month at 00:30 UTC
    _scheduler.add_job(
        _run_monthly_usage_reset,
        CronTrigger(day=1, hour=0, minute=30),
        id="monthly_usage_reset",
        name="Monthly Usage Reset",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    # Scheduled reports — check every hour at :00
    _scheduler.add_job(
        _run_scheduled_reports,
        CronTrigger(minute=0),
        id="scheduled_reports",
        name="Scheduled Report Delivery",
        replace_existing=True,
        misfire_grace_time=1800,
    )

    # Recycle-bin purge — daily at 03:15 UTC
    _scheduler.add_job(
        _run_bin_purge,
        CronTrigger(hour=3, minute=15),
        id="bin_purge",
        name="Recycle-bin 360-day purge",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    _scheduler.start()
    logger.info("[Scheduler] Started — daily digest @ 07:00 UTC, monthly usage reset @ 1st 00:30 UTC, scheduled reports @ :00 each hour, bin purge @ 03:15 UTC")


def stop_scheduler():
    """Gracefully stop the scheduler. Call on app shutdown."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("[Scheduler] Stopped")
