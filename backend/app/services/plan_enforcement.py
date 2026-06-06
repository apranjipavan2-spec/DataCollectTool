"""Plan limit enforcement for FieldGovern.

Every public function returns:
  {"allowed": bool, "reason": str, "used": <current>, "limit": <cap>}

Limits are loaded from the DB unified Plan row (editable by super-admin) with
automatic fallback to the hardcoded PLAN_LIMITS dict in app.core.plan_limits.

Usage:
    result = check_submission_limit(db, tenant_id, plan_tier)
    if not result["allowed"]:
        raise HTTPException(status_code=402, detail=result["reason"])
"""
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.submission import Submission
from app.models.billing import UsageRecord
from app.core.plan_limits import _limits_for_db


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_or_create_usage_record(db: Session, tenant_id: str) -> UsageRecord:
    now = datetime.now(timezone.utc)
    rec = (
        db.query(UsageRecord)
        .filter(
            UsageRecord.tenant_id == tenant_id,
            UsageRecord.period_year == now.year,
            UsageRecord.period_month == now.month,
        )
        .first()
    )
    if not rec:
        rec = UsageRecord(tenant_id=tenant_id, period_year=now.year, period_month=now.month)
        db.add(rec)
        db.flush()
    return rec


# ── Submissions ───────────────────────────────────────────────────────────────

def check_submission_limit(db: Session, tenant_id: str, plan_tier: str) -> dict:
    """Return {"allowed": bool, "reason": str, "used": int, "limit": int, "mode": str}."""
    limits = _limits_for_db(plan_tier, db)
    monthly_limit: int = limits["submissions_per_month"]

    if monthly_limit < 0:
        return {"allowed": True, "reason": "", "used": 0, "limit": -1, "mode": "unlimited"}

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    used = (
        db.query(func.count(Submission.id))
        .filter(
            Submission.tenant_id == tenant_id,
            Submission.server_received_at >= month_start,
        )
        .scalar() or 0
    )

    if used >= monthly_limit:
        return {
            "allowed": False,
            "reason": (
                f"Monthly submission limit reached ({used}/{monthly_limit} on the {plan_tier} plan). "
                f"Upgrade your plan to continue collecting data."
            ),
            "used": used,
            "limit": monthly_limit,
            "mode": "monthly",
        }
    return {"allowed": True, "reason": "", "used": used, "limit": monthly_limit, "mode": "monthly"}


# ── Active forms ──────────────────────────────────────────────────────────────

def check_active_forms_limit(db: Session, tenant_id: str, plan_tier: str) -> dict:
    """Check count of active forms (status='active') against plan limit.

    Drafts and archived forms are not counted — only forms currently collecting data.
    """
    from app.models.form import Form

    limits = _limits_for_db(plan_tier, db)
    limit: int = limits.get("active_forms", -1)

    if limit < 0:
        return {"allowed": True, "reason": "", "used": 0, "limit": -1}

    used = (
        db.query(func.count(Form.id))
        .filter(Form.tenant_id == tenant_id, Form.status == "active")
        .scalar() or 0
    )

    if used >= limit:
        return {
            "allowed": False,
            "reason": (
                f"Active form limit reached ({used}/{limit} on the {plan_tier} plan). "
                f"Archive a form or upgrade your plan to activate more."
            ),
            "used": used,
            "limit": limit,
        }
    return {"allowed": True, "reason": "", "used": used, "limit": limit}


# ── Storage ───────────────────────────────────────────────────────────────────

def check_storage_limit(db: Session, tenant_id: str, plan_tier: str) -> dict:
    """Check total media storage (sum of MediaFile.file_size_bytes) against plan limit."""
    from app.models.media_file import MediaFile

    limits = _limits_for_db(plan_tier, db)
    limit_mb: int = limits.get("storage_mb", -1)

    if limit_mb < 0:
        return {"allowed": True, "reason": "", "used_mb": 0.0, "limit_mb": -1}

    total_bytes = (
        db.query(func.sum(MediaFile.file_size_bytes))
        .filter(MediaFile.tenant_id == tenant_id)
        .scalar() or 0
    )
    used_mb = round(total_bytes / (1024 * 1024), 2)

    if used_mb >= limit_mb:
        return {
            "allowed": False,
            "reason": (
                f"Storage limit reached ({used_mb:.1f} MB / {limit_mb} MB on the {plan_tier} plan). "
                f"Delete media files or upgrade your plan to continue uploading."
            ),
            "used_mb": used_mb,
            "limit_mb": limit_mb,
        }
    return {"allowed": True, "reason": "", "used_mb": used_mb, "limit_mb": limit_mb}


# ── AI reports ────────────────────────────────────────────────────────────────

def check_ai_reports_limit(db: Session, tenant_id: str, plan_tier: str) -> dict:
    """Check monthly AI report generation against plan limit."""
    limits = _limits_for_db(plan_tier, db)
    limit: int = limits.get("ai_reports_per_month", 0)

    if limit < 0:
        return {"allowed": True, "reason": "", "used": 0, "limit": -1}

    if limit == 0:
        return {
            "allowed": False,
            "reason": (
                f"AI reports are not available on the {plan_tier} plan. "
                f"Upgrade to Starter or above to generate AI reports."
            ),
            "used": 0,
            "limit": 0,
        }

    rec = _get_or_create_usage_record(db, tenant_id)
    used = rec.ai_reports_used or 0

    if used >= limit:
        return {
            "allowed": False,
            "reason": (
                f"Monthly AI report limit reached ({used}/{limit} on the {plan_tier} plan). "
                f"Limit resets on the 1st of next month, or upgrade your plan."
            ),
            "used": used,
            "limit": limit,
        }
    return {"allowed": True, "reason": "", "used": used, "limit": limit}


def increment_ai_reports(db: Session, tenant_id: str) -> None:
    """Increment ai_reports_used for the current billing month."""
    rec = _get_or_create_usage_record(db, tenant_id)
    rec.ai_reports_used = (rec.ai_reports_used or 0) + 1
    db.commit()


# ── API calls ─────────────────────────────────────────────────────────────────

def check_api_calls_limit(db: Session, tenant_id: str, plan_tier: str) -> dict:
    """Check monthly API call count (API-key authenticated requests) against plan limit."""
    limits = _limits_for_db(plan_tier, db)
    limit: int = limits.get("api_calls_per_month", 0)

    if limit < 0:
        return {"allowed": True, "reason": "", "used": 0, "limit": -1}

    if limit == 0:
        return {
            "allowed": False,
            "reason": (
                f"API access is not available on the {plan_tier} plan. "
                f"Upgrade to Starter or above to use the API."
            ),
            "used": 0,
            "limit": 0,
        }

    rec = _get_or_create_usage_record(db, tenant_id)
    used = rec.api_calls_used or 0

    if used >= limit:
        return {
            "allowed": False,
            "reason": (
                f"Monthly API call limit reached ({used}/{limit} on the {plan_tier} plan). "
                f"Limit resets on the 1st of next month, or upgrade your plan."
            ),
            "used": used,
            "limit": limit,
        }
    return {"allowed": True, "reason": "", "used": used, "limit": limit}


def increment_api_calls(db: Session, tenant_id: str) -> None:
    """Increment api_calls_used for the current billing month."""
    rec = _get_or_create_usage_record(db, tenant_id)
    rec.api_calls_used = (rec.api_calls_used or 0) + 1
    db.commit()
