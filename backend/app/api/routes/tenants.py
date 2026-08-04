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

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_role
from app.models.audit_log import AuditLog
from app.core.security import hash_password
from app.core.plan_limits import PLAN_LIMITS, _limits_for, _limits_for_db
from app.models.tenant import Tenant
from app.models.user import User
from app.models.submission import Submission
from app.models.form import Form
from app.models.media_file import MediaFile
from app.models.billing import UsageRecord

router = APIRouter()

require_master = require_role("master_admin")


# ── Branding (public-ish, needs auth) ─────────────────────────────────────

@router.get("/branding")
def get_branding(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Return tenant branding for the current user's tenant."""
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    if not tenant:
        return {"name": "FieldGovern", "logo_url": "", "primary_color": "#2563EB", "app_name": "FieldGovern"}
    return {
        "id": str(tenant.id),
        "name": tenant.name,
        "logo_url": tenant.logo_url or "",
        "primary_color": tenant.primary_color or "#2563EB",
        "app_name": tenant.app_name if hasattr(tenant, "app_name") and tenant.app_name else tenant.name,
        "plan_tier": tenant.plan_tier,
        "allow_enumerator_edit": getattr(tenant, "allow_enumerator_edit", True),
        "qr_login_enabled": bool((tenant.notification_config or {}).get("qr_login_enabled", False)),
    }


# ── Usage (org_admin / supervisor — own tenant) ───────────────────────────

@router.get("/me/usage")
def get_my_usage(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Return current-month usage vs plan limits for the caller's tenant."""
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    limits = _limits_for_db(tenant.plan_tier, db)
    tid = user["tenant_id"]
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    subs_used = (
        db.query(func.count(Submission.id))
        .filter(Submission.tenant_id == tid, Submission.server_received_at >= month_start)
        .scalar() or 0
    )
    active_forms_count = (
        db.query(func.count(Form.id))
        .filter(Form.tenant_id == tid, Form.status == "active")
        .scalar() or 0
    )
    users_count = (
        db.query(func.count(User.id))
        .filter(User.tenant_id == tid, User.is_active == True)
        .scalar() or 0
    )
    admins_count = (
        db.query(func.count(User.id))
        .filter(User.tenant_id == tid, User.is_active == True, User.role == "org_admin")
        .scalar() or 0
    )
    storage_bytes = (
        db.query(func.sum(MediaFile.file_size_bytes))
        .filter(MediaFile.tenant_id == tid)
        .scalar() or 0
    )
    storage_used_mb = round(storage_bytes / (1024 * 1024), 2)

    usage_rec = (
        db.query(UsageRecord)
        .filter(
            UsageRecord.tenant_id == tid,
            UsageRecord.period_year == now.year,
            UsageRecord.period_month == now.month,
        )
        .first()
    )
    ai_reports_used = (usage_rec.ai_reports_used or 0) if usage_rec else 0
    api_calls_used  = (getattr(usage_rec, "api_calls_used", 0) or 0) if usage_rec else 0

    return {
        "plan_tier": tenant.plan_tier,
        "limits": limits,
        "usage": {
            "submissions_this_month": subs_used,
            "active_forms":          active_forms_count,
            "storage_used_mb":       storage_used_mb,
            "ai_reports_this_month": ai_reports_used,
            "api_calls_this_month":  api_calls_used,
            "users":                 users_count,
            "admins":                admins_count,
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
    admin_password: str = "fieldgovern123"


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    app_name: Optional[str] = None
    plan_tier: Optional[str] = None
    subscription_status: Optional[str] = None
    allow_enumerator_edit: Optional[bool] = None


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

    from datetime import timedelta
    from app.models.billing import Subscription, Plan as BillingPlan
    # Find the unified plan row for the requested tier; fall back to ngo_free
    unified_plan = db.query(BillingPlan).filter(
        BillingPlan.segment == "unified",
        BillingPlan.tier == body.plan_tier,
        BillingPlan.is_active == True,
    ).first()
    initial_plan_id = unified_plan.id if unified_plan else "ngo_free"
    trial_sub = Subscription(
        tenant_id=tenant.id,
        plan_id=initial_plan_id,
        billing_cycle="monthly",
        status="trialing",
        trial_start=datetime.now(timezone.utc),
        trial_end=datetime.now(timezone.utc) + timedelta(days=30),
    )
    db.add(trial_sub)
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
    request: Request,
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

    updates = body.model_dump(exclude_unset=True)
    new_plan_tier = updates.pop("plan_tier", None)

    # Only master_admin may change plan_tier
    if new_plan_tier and user["role"] != "master_admin":
        raise HTTPException(status_code=403, detail="Only master admin can change plan tier")

    for field, value in updates.items():
        if hasattr(tenant, field):
            setattr(tenant, field, value)

    # When plan_tier changes, sync the Subscription row so both paths stay consistent
    if new_plan_tier and new_plan_tier != tenant.plan_tier:
        old_plan_tier = tenant.plan_tier
        db.add(AuditLog(
            tenant_id=tenant.id, user_id=_uuid.UUID(user["sub"]),
            action="master_admin_update_plan", resource="tenant", resource_id=str(tenant.id),
            detail={"before": old_plan_tier, "after": new_plan_tier},
            ip_address=request.client.host if request.client else None,
        ))
        from app.models.billing import Subscription, Plan as BillingPlan
        unified_plan = db.query(BillingPlan).filter(
            BillingPlan.segment == "unified",
            BillingPlan.tier == new_plan_tier,
            BillingPlan.is_active == True,
        ).first()
        if unified_plan:
            sub = db.query(Subscription).filter(Subscription.tenant_id == tenant.id).first()
            if sub:
                sub.plan_id = unified_plan.id
            else:
                from datetime import timedelta
                db.add(Subscription(
                    tenant_id=tenant.id,
                    plan_id=unified_plan.id,
                    billing_cycle="monthly",
                    status="active",
                ))
        tenant.plan_tier = new_plan_tier

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


# ── Integrations settings (notification_config + sheets per form) ─────────────

class NotificationConfigUpdate(BaseModel):
    whatsapp_enabled: bool = False
    msg91_auth_key: str = ""
    msg91_template_id: str = ""
    notify_events: list[str] = ["submission.created", "submission.flagged", "import.complete"]
    notify_numbers: list[str] = []
    telegram_enabled: bool = False
    telegram_bot_token: str = ""
    telegram_chat_ids: list[str] = []


@router.get("/integrations")
def get_integrations(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Get current tenant's notification_config (org_admin only)."""
    if user["role"] not in ("master_admin", "org_admin"):
        raise HTTPException(403, "org_admin required")
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    cfg = tenant.notification_config or {}
    masked = dict(cfg)
    if masked.get("msg91_auth_key"):
        masked["msg91_auth_key"] = "••••" + masked["msg91_auth_key"][-4:]
    if masked.get("telegram_bot_token"):
        token = masked["telegram_bot_token"]
        masked["telegram_bot_token"] = token[:10] + "..." if len(token) > 10 else token
    return masked


@router.patch("/integrations/notifications")
def update_notification_config(
    body: NotificationConfigUpdate,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update WhatsApp + Telegram notification config for the current tenant."""
    if user["role"] not in ("master_admin", "org_admin"):
        raise HTTPException(403, "org_admin required")
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    if not tenant:
        raise HTTPException(404, "Tenant not found")

    existing = dict(tenant.notification_config or {})
    new_key = body.msg91_auth_key
    if new_key.startswith("••••"):
        new_key = existing.get("msg91_auth_key", "")

    new_tg_token = body.telegram_bot_token
    if new_tg_token.endswith("..."):
        new_tg_token = existing.get("telegram_bot_token", "")

    existing.update({
        "whatsapp_enabled": body.whatsapp_enabled,
        "msg91_auth_key": new_key,
        "msg91_template_id": body.msg91_template_id,
        "notify_events": body.notify_events,
        "notify_numbers": body.notify_numbers,
        "telegram_enabled": body.telegram_enabled,
        "telegram_bot_token": new_tg_token,
        "telegram_chat_ids": body.telegram_chat_ids,
    })
    tenant.notification_config = existing
    db.commit()
    return {"ok": True}


# ── Security settings (QR login toggle) ──────────────────────────────────────

class SecuritySettingsUpdate(BaseModel):
    qr_login_enabled: bool = False
    two_fa_enabled: bool = False


@router.get("/security")
def get_security_settings(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Get security settings for the current tenant (org_admin only)."""
    if user["role"] not in ("master_admin", "org_admin"):
        raise HTTPException(403, "org_admin required")
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    cfg = tenant.notification_config or {}
    return {
        "qr_login_enabled": bool(cfg.get("qr_login_enabled", False)),
        "two_fa_enabled": bool(cfg.get("two_fa_enabled", False)),
    }


@router.patch("/security")
def update_security_settings(
    body: SecuritySettingsUpdate,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Toggle security settings for the current tenant (org_admin only)."""
    if user["role"] not in ("master_admin", "org_admin"):
        raise HTTPException(403, "org_admin required")
    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    if not tenant:
        raise HTTPException(404, "Tenant not found")

    if body.two_fa_enabled:
        from app.models.billing import Subscription, Plan as BillingPlan
        sub = (
            db.query(Subscription)
            .filter(Subscription.tenant_id == user["tenant_id"])
            .order_by(Subscription.created_at.desc())
            .first()
        )
        plan = db.query(BillingPlan).filter(BillingPlan.id == sub.plan_id).first() if sub else None
        if not plan or not plan.two_fa:
            raise HTTPException(403, "Two-factor authentication requires a plan that includes this feature. Upgrade your plan to unlock 2FA.")

    existing = dict(tenant.notification_config or {})
    existing["qr_login_enabled"] = body.qr_login_enabled
    existing["two_fa_enabled"] = body.two_fa_enabled
    tenant.notification_config = existing
    db.commit()
    return {"qr_login_enabled": body.qr_login_enabled, "two_fa_enabled": body.two_fa_enabled}


class FormSheetsSyncUpdate(BaseModel):
    form_id: str
    enabled: bool = False
    apps_script_url: str = ""
    include_metadata: bool = True


@router.patch("/integrations/sheets")
def update_form_sheets_sync(
    body: FormSheetsSyncUpdate,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update Google Sheets sync config for a specific form."""
    if user["role"] not in ("master_admin", "org_admin"):
        raise HTTPException(403, "org_admin required")
    form = db.query(Form).filter(
        Form.id == body.form_id,
        Form.tenant_id == user["tenant_id"],
    ).first()
    if not form:
        raise HTTPException(404, "Form not found")
    form.sheets_sync_config = {
        "enabled": body.enabled,
        "apps_script_url": body.apps_script_url,
        "include_metadata": body.include_metadata,
    }
    db.commit()
    return {"ok": True}
