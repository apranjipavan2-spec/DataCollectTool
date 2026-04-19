"""
Tenant management endpoints.

- GET /tenants/branding — Public: returns tenant branding (logo, colors, name) for the frontend
- GET /tenants/ — Master admin: list all tenants
- POST /tenants/ — Master admin: create a new tenant
- PATCH /tenants/{id} — Master/org admin: update tenant settings
- GET /tenants/{id}/stats — Admin: usage statistics
"""
import uuid as _uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_role
from app.core.security import hash_password
from app.models.tenant import Tenant
from app.models.user import User
from app.models.submission import Submission
from app.models.form import Form

router = APIRouter()

require_master = require_role("master_admin")

# ── Plan limits ───────────────────────────────────────────────────────────────
# -1 = unlimited

PLAN_LIMITS: dict[str, dict] = {
    "free":         {"submissions_per_month": 100,   "users": 5,   "forms": 3},
    "starter":      {"submissions_per_month": 5_000, "users": 25,  "forms": 20},
    "professional": {"submissions_per_month": 50_000,"users": 100, "forms": 100},
    "enterprise":   {"submissions_per_month": -1,    "users": -1,  "forms": -1},
}

def _limits_for(plan_tier: str) -> dict:
    return PLAN_LIMITS.get(plan_tier, PLAN_LIMITS["free"])


# ── Branding (public-ish, needs auth) ─────────────────────────────────────

@router.get("/branding")
def get_branding(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Return tenant branding for the current user's tenant."""
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    if not tenant:
        return {"name": "FieldPulse", "logo_url": "", "primary_color": "#2563EB", "app_name": "FieldPulse"}
    return {
        "id": str(tenant.id),
        "name": tenant.name,
        "logo_url": tenant.logo_url or "",
        "primary_color": tenant.primary_color or "#2563EB",
        "app_name": tenant.app_name if hasattr(tenant, "app_name") and tenant.app_name else tenant.name,
        "plan_tier": tenant.plan_tier,
    }


# ── Usage (org_admin / supervisor — own tenant) ───────────────────────────

@router.get("/me/usage")
def get_my_usage(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Return current-month usage vs plan limits for the caller's tenant."""
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    limits = _limits_for(tenant.plan_tier)

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    subs_this_month = db.query(func.count(Submission.id)).filter(
        Submission.tenant_id == user["tenant_id"],
        Submission.server_received_at >= month_start,
    ).scalar() or 0

    users_count = db.query(func.count(User.id)).filter(
        User.tenant_id == user["tenant_id"],
        User.is_active == True,
    ).scalar() or 0

    forms_count = db.query(func.count(Form.id)).filter(
        Form.tenant_id == user["tenant_id"],
    ).scalar() or 0

    return {
        "plan_tier": tenant.plan_tier,
        "limits": limits,
        "usage": {
            "submissions_this_month": subs_this_month,
            "users": users_count,
            "forms": forms_count,
        },
    }


# ── CRUD (master admin) ───────────────────────────────────────────────────

class TenantCreate(BaseModel):
    name: str
    plan_tier: str = "starter"
    primary_color: str = "#2563EB"
    logo_url: str = ""
    app_name: str = ""
    # First admin user
    admin_phone: str
    admin_name: str
    admin_password: str = "fieldpulse123"


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    app_name: Optional[str] = None
    plan_tier: Optional[str] = None
    subscription_status: Optional[str] = None


@router.get("/")
def list_tenants(user=Depends(require_master), db: Session = Depends(get_db)):
    """List all tenants with basic stats (master admin only)."""
    tenants = db.query(Tenant).order_by(Tenant.created_at.desc()).all()

    # Batch-fetch counts
    user_counts = dict(
        db.query(User.tenant_id, func.count(User.id))
        .filter(User.is_active == True)
        .group_by(User.tenant_id)
        .all()
    )
    sub_counts = dict(
        db.query(Submission.tenant_id, func.count(Submission.id))
        .group_by(Submission.tenant_id)
        .all()
    )
    form_counts = dict(
        db.query(Form.tenant_id, func.count(Form.id))
        .group_by(Form.tenant_id)
        .all()
    )

    return [
        {
            "id": str(t.id),
            "name": t.name,
            "logo_url": t.logo_url or "",
            "primary_color": t.primary_color or "#2563EB",
            "app_name": getattr(t, "app_name", "") or t.name,
            "plan_tier": t.plan_tier,
            "subscription_status": t.subscription_status,
            "users_count": user_counts.get(t.id, 0),
            "submissions_count": sub_counts.get(t.id, 0),
            "forms_count": form_counts.get(t.id, 0),
            "created_at": t.created_at.isoformat() if t.created_at else "",
        }
        for t in tenants
    ]


@router.post("/")
def create_tenant(body: TenantCreate, user=Depends(require_master), db: Session = Depends(get_db)):
    """Create a new tenant with its first admin user."""
    tenant = Tenant(
        name=body.name,
        plan_tier=body.plan_tier,
        primary_color=body.primary_color,
        logo_url=body.logo_url,
    )
    # Set app_name if the column exists
    if hasattr(tenant, "app_name"):
        tenant.app_name = body.app_name or body.name
    db.add(tenant)
    db.flush()

    # Create the first org_admin for this tenant
    admin = User(
        tenant_id=tenant.id,
        phone=body.admin_phone,
        name=body.admin_name,
        role="org_admin",
        password_hash=hash_password(body.admin_password),
    )
    db.add(admin)
    db.commit()

    return {
        "id": str(tenant.id),
        "name": tenant.name,
        "admin_id": str(admin.id),
    }


@router.patch("/{tenant_id}")
def update_tenant(
    tenant_id: str,
    body: TenantUpdate,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update tenant settings. Master admin can update any; org_admin can update own."""
    if user["role"] not in ("master_admin", "org_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    # Org admins can only update their own tenant; master_admin can update any
    if user["role"] == "org_admin" and str(user["tenant_id"]) != tenant_id:
        raise HTTPException(status_code=403, detail="Cannot update another tenant")

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        if hasattr(tenant, field):
            setattr(tenant, field, value)

    db.commit()
    return {"id": str(tenant.id), "name": tenant.name}


@router.get("/{tenant_id}/stats")
def get_tenant_stats(tenant_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Get detailed stats for a tenant."""
    if user["role"] not in ("master_admin", "org_admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    if user["role"] == "org_admin" and str(user["tenant_id"]) != tenant_id:
        raise HTTPException(status_code=403, detail="Cannot view another tenant")

    users_count = db.query(func.count(User.id)).filter(
        User.tenant_id == tenant_id, User.is_active == True
    ).scalar()
    subs_count = db.query(func.count(Submission.id)).filter(
        Submission.tenant_id == tenant_id
    ).scalar()
    forms_count = db.query(func.count(Form.id)).filter(
        Form.tenant_id == tenant_id
    ).scalar()

    # Submissions per day (last 30 days)
    from datetime import datetime, timedelta
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    daily = (
        db.query(
            func.date_trunc("day", Submission.server_received_at).label("day"),
            func.count(Submission.id),
        )
        .filter(Submission.tenant_id == tenant_id, Submission.server_received_at >= thirty_days_ago)
        .group_by("day")
        .order_by("day")
        .all()
    )

    return {
        "users_count": users_count,
        "submissions_count": subs_count,
        "forms_count": forms_count,
        "daily_submissions": [
            {"date": d[0].isoformat()[:10] if d[0] else "", "count": d[1]}
            for d in daily
        ],
    }
