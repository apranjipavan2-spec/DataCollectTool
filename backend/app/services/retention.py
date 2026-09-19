"""Per-form DPDP retention policy (item 23): submissions older than a form's
configured retention_days are automatically anonymized (not hard-deleted —
matches the rest of the app's soft-erasure convention), with an in-app
reminder to org_admins a fixed number of days before expiry so it's never a
surprise.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

REMINDER_DAYS_BEFORE = 7


def is_past_retention(server_received_at: datetime, retention_days: int, now: datetime) -> bool:
    """True once a submission is older than its form's retention window."""
    if server_received_at is None:
        return False
    return now - server_received_at > timedelta(days=retention_days)


def is_reminder_due(server_received_at: datetime, retention_days: int, now: datetime,
                     reminder_days_before: int = REMINDER_DAYS_BEFORE) -> bool:
    """True on the single day a submission is exactly `reminder_days_before`
    days away from expiring — fires once per submission, assuming the job
    that calls this runs at most once a day (matches every other scheduler
    job's cadence). Comparing whole days, not exact timestamps, since a job
    that runs a few minutes late shouldn't miss the window entirely."""
    if server_received_at is None:
        return False
    days_old = (now - server_received_at).days
    days_until_expiry = retention_days - days_old
    return days_until_expiry == reminder_days_before


def run_retention_expiry(db: Session) -> dict:
    """Scan every form with a retention policy, anonymize expired
    submissions, and send one reminder notification per submission
    approaching expiry. Returns counts for logging."""
    from app.models.form import Form
    from app.models.submission import Submission
    from app.models.user import User
    from app.services.notify import create_notification

    now = datetime.now(timezone.utc)
    anonymized_count = 0
    reminders_sent = 0

    forms = db.query(Form).filter(Form.retention_days.isnot(None)).all()
    for form in forms:
        subs = db.query(Submission).filter(
            Submission.form_id == form.id,
            Submission.server_received_at.isnot(None),
        ).all()

        admins = None  # lazily loaded only if a reminder is actually needed
        for sub in subs:
            if (sub.data_json or {}).get("anonymized") is True:
                continue  # already erased — nothing to do or remind about

            if is_past_retention(sub.server_received_at, form.retention_days, now):
                from app.api.routes.submissions import _erase_submission_row
                _erase_submission_row(
                    db, sub, action="retention_expiry_anonymized",
                    tenant_id=form.tenant_id, user_id=None, ip_address=None,
                    extra_detail={"form_id": str(form.id), "retention_days": form.retention_days},
                )
                anonymized_count += 1
                continue

            if is_reminder_due(sub.server_received_at, form.retention_days, now):
                if admins is None:
                    admins = db.query(User).filter(
                        User.tenant_id == form.tenant_id,
                        User.role == "org_admin",
                        User.is_active == True,
                    ).all()
                for admin in admins:
                    create_notification(
                        db, tenant_id=form.tenant_id, recipient_id=admin.id,
                        notif_type="retention_expiry_warning",
                        title="A submission is nearing its retention limit",
                        body=f"A response to \"{form.title}\" will be automatically anonymized in {REMINDER_DAYS_BEFORE} days per its retention policy.",
                        link=f"/dashboard?form_id={form.id}",
                    )
                    reminders_sent += 1

    db.commit()
    logger.info("[Retention] %d submissions anonymized, %d reminders sent", anonymized_count, reminders_sent)
    return {"anonymized": anonymized_count, "reminders_sent": reminders_sent}
