"""Plan limit enforcement for FieldGovern.

Checks current-month usage against the tenant's plan limits before allowing
writes (sync push, submission create).  Returns a dict with `allowed: bool`
and a human-readable `reason` string.

Usage:
    result = check_submission_limit(db, tenant_id, plan_tier)
    if not result["allowed"]:
        raise HTTPException(status_code=402, detail=result["reason"])
"""
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.submission import Submission
from app.api.routes.tenants import PLAN_LIMITS, _limits_for


def check_submission_limit(db: Session, tenant_id: str, plan_tier: str) -> dict:
    """Return {"allowed": bool, "reason": str, "used": int, "limit": int}."""
    limits = _limits_for(plan_tier)
    monthly_limit: int = limits["submissions_per_month"]

    if monthly_limit < 0:
        # Unlimited plan
        return {"allowed": True, "reason": "", "used": 0, "limit": -1}

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
        }

    return {"allowed": True, "reason": "", "used": used, "limit": monthly_limit}
