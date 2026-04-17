"""Daily digest service — gather yesterday's stats per tenant and email supervisors/admins.

Called by:
  - POST /reports/digest  (manual trigger from dashboard)
  - scripts/send_digest.py  (cron job — run daily at e.g. 07:00)
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.submission import Submission
from app.models.form import Form
from app.models.user import User
from app.models.tenant import Tenant
from app.services.email import send_daily_digest_email

logger = logging.getLogger(__name__)


def _yesterday_range() -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    end = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start = end - timedelta(days=1)
    return start, end


def send_digest_for_tenant(db: Session, tenant_id: str) -> dict:
    """Compute stats and email all admins/supervisors with an email for one tenant.

    Returns {"sent": int, "skipped": int, "tenant": str}.
    """
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        return {"sent": 0, "skipped": 0, "tenant": str(tenant_id)}

    start, end = _yesterday_range()
    date_label = start.strftime("%B %-d, %Y")  # e.g. "April 15, 2026"

    # ── Yesterday's submissions ──────────────────────────────────────────
    yesterday_subs = (
        db.query(Submission)
        .filter(
            Submission.tenant_id == tenant_id,
            Submission.server_received_at >= start,
            Submission.server_received_at < end,
        )
        .all()
    )

    total_yesterday = len(yesterday_subs)

    # ── All-time count ───────────────────────────────────────────────────
    total_alltime = (
        db.query(func.count(Submission.id))
        .filter(Submission.tenant_id == tenant_id)
        .scalar() or 0
    )

    # ── Flagged open ────────────────────────────────────────────────────
    flagged_open = (
        db.query(func.count(Submission.id))
        .filter(
            Submission.tenant_id == tenant_id,
            Submission.status == "flagged",
        )
        .scalar() or 0
    )

    # ── Top enumerators from yesterday ──────────────────────────────────
    user_map = {
        str(u.id): u.name or u.phone
        for u in db.query(User).filter(User.tenant_id == tenant_id).all()
    }

    enum_counts: dict[str, int] = {}
    for s in yesterday_subs:
        uid = str(s.enumerator_id) if s.enumerator_id else "unknown"
        enum_counts[uid] = enum_counts.get(uid, 0) + 1

    top_enumerators = sorted(
        [{"name": user_map.get(uid, uid), "count": cnt} for uid, cnt in enum_counts.items()],
        key=lambda x: x["count"],
        reverse=True,
    )[:5]

    # ── Form breakdown from yesterday ───────────────────────────────────
    form_map = {
        str(f.id): f.title
        for f in db.query(Form).filter(Form.tenant_id == tenant_id).all()
    }

    form_counts: dict[str, int] = {}
    for s in yesterday_subs:
        fid = str(s.form_id)
        form_counts[fid] = form_counts.get(fid, 0) + 1

    form_breakdown = sorted(
        [{"title": form_map.get(fid, fid), "count": cnt} for fid, cnt in form_counts.items()],
        key=lambda x: x["count"],
        reverse=True,
    )[:8]

    # ── Recipients: org_admin + supervisor with an email set ────────────
    recipients = (
        db.query(User)
        .filter(
            User.tenant_id == tenant_id,
            User.role.in_(["org_admin", "supervisor"]),
            User.is_active == True,
            User.email.isnot(None),
            User.email != "",
        )
        .all()
    )

    sent = skipped = 0
    for rec in recipients:
        ok = send_daily_digest_email(
            to=rec.email,
            recipient_name=rec.name or rec.phone,
            org_name=tenant.name,
            date_label=date_label,
            total_yesterday=total_yesterday,
            total_alltime=total_alltime,
            flagged_open=flagged_open,
            top_enumerators=top_enumerators,
            form_breakdown=form_breakdown,
        )
        if ok:
            sent += 1
        else:
            skipped += 1

    logger.info(
        "[Digest] Tenant %s (%s): sent=%d skipped=%d yesterday=%d",
        tenant.name, tenant_id, sent, skipped, total_yesterday,
    )
    return {"sent": sent, "skipped": skipped, "tenant": tenant.name}


def send_digest_all_tenants(db: Session) -> list[dict]:
    """Send digest to every active tenant. Called by the cron script."""
    tenant_ids = [row[0] for row in db.query(Tenant.id).all()]
    results = []
    for tid in tenant_ids:
        results.append(send_digest_for_tenant(db, str(tid)))
    return results
