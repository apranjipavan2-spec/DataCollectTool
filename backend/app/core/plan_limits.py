"""Centralized plan limits — hardcoded defaults + DB-driven overrides.

Sentinel values:
  -1  = unlimited (no cap on this dimension)
   0  = feature not available on this plan (blocked outright)

When a "unified" Plan row exists in the DB for a given tier, it takes precedence
over these hardcoded defaults. The super-admin can edit unified Plan rows via
PATCH /billing/admin/plans/{plan_id} to change limits platform-wide without a
code deploy.  See `_limits_for_db()` below.

Monthly counters (submissions, AI reports, API calls) reset on the 1st of each UTC month.
"""

# Hardcoded fallback — used when no unified Plan row exists in the DB.
PLAN_LIMITS: dict[str, dict] = {
    "free": {
        "submissions_per_month": 300,
        "active_forms":          2,
        "storage_mb":            50,
        "ai_reports_per_month":  0,   # not available on free
        "api_calls_per_month":   0,   # not available on free
        "admins":                1,
        "users":                -1,   # enumerators always unlimited
    },
    "starter": {
        "submissions_per_month": 2_000,
        "active_forms":          8,
        "storage_mb":            500,
        "ai_reports_per_month":  8,
        "api_calls_per_month":   3_000,
        "admins":                2,
        "users":                -1,
    },
    "growth": {
        "submissions_per_month": 5_000,
        "active_forms":          20,
        "storage_mb":            5_120,   # 5 GB
        "ai_reports_per_month":  30,
        "api_calls_per_month":   10_000,
        "admins":                5,
        "users":                -1,
    },
    "pro": {
        "submissions_per_month": 25_000,
        "active_forms":          100,
        "storage_mb":            10_240,  # 10 GB
        "ai_reports_per_month":  100,
        "api_calls_per_month":   25_000,
        "admins":                20,
        "users":                -1,
    },
    "custom": {
        "submissions_per_month": -1,
        "active_forms":          -1,
        "storage_mb":            -1,
        "ai_reports_per_month":  -1,
        "api_calls_per_month":   -1,
        "admins":                -1,
        "users":                -1,
    },
    # ── Legacy tier aliases (tenants provisioned before v2 pricing) ────────────
    "professional": {
        "submissions_per_month": 5_000,
        "active_forms":          20,
        "storage_mb":            5_120,
        "ai_reports_per_month":  30,
        "api_calls_per_month":   10_000,
        "admins":                5,
        "users":                -1,
    },
    "enterprise": {
        "submissions_per_month": -1,
        "active_forms":          -1,
        "storage_mb":            -1,
        "ai_reports_per_month":  -1,
        "api_calls_per_month":   -1,
        "admins":                -1,
        "users":                -1,
    },
}


def _limits_for(plan_tier: str) -> dict:
    """Return hardcoded limits for plan_tier. Use _limits_for_db() in routes that have a DB session."""
    return PLAN_LIMITS.get(plan_tier, PLAN_LIMITS["free"])


def _plan_row_to_limits(plan) -> dict:
    """Convert a Plan ORM row (segment='unified') to the enforcement limits dict.

    The Plan model stores None for unlimited columns; we normalize to -1 for the
    enforcement layer.  A stored 0 means 'feature not available'.
    """
    def _col(val: int | None, fallback: int = -1) -> int:
        return val if val is not None else fallback

    return {
        "submissions_per_month": _col(plan.submissions_limit),
        "active_forms":          _col(plan.active_forms_limit),
        "storage_mb":            _col(plan.storage_limit_mb),
        "ai_reports_per_month":  _col(plan.ai_reports_per_month),
        "api_calls_per_month":   _col(plan.api_calls_per_month),
        "admins":                _col(plan.max_org_admins),
        "users":                -1,  # total users always unlimited
    }


def _limits_for_db(plan_tier: str, db) -> dict:
    """Return limits from the DB unified Plan row, falling back to hardcoded defaults.

    Call this in any route/service that has a database session so that super-admin
    changes propagate immediately without a code deploy.
    """
    from app.models.billing import Plan

    plan = (
        db.query(Plan)
        .filter(Plan.segment == "unified", Plan.tier == plan_tier, Plan.is_active == True)
        .first()
    )
    if plan:
        return _plan_row_to_limits(plan)
    return PLAN_LIMITS.get(plan_tier, PLAN_LIMITS["free"])
