"""
Billing — offline UPI payment flow.

Flow:
  1. User picks plan → POST /billing/request  → gets order_ref + UPI details + QR data
  2. User pays via UPI/bank → POST /billing/utr  → submits UTR number
  3. master_admin reviews → PATCH /billing/admin/requests/{id}/confirm or /reject
  4. On confirm → subscription activated immediately
"""
import random, string
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import and_, text

from app.core.database import get_db
from app.core.deps import get_current_user, require_role
from app.models.billing import Plan, Subscription, PaymentRequest, UsageRecord
from app.models.system_setting import SystemSetting
from app.models.tenant import Tenant
from app.models.user import User

router = APIRouter(prefix="/billing", tags=["billing"])

# ── Constants ──────────────────────────────────────────────────────────────────

CYCLE_DISCOUNT = {"monthly": 0, "6month": 10, "annual": 20, "3year": 30}
CYCLE_MONTHS   = {"monthly": 1, "6month": 6,  "annual": 12, "3year": 36}

_PAYMENT_DEFAULTS = {
    "upi_id":         "fieldgovernindia@upi",
    "upi_name":       "FieldGovern Technologies",
    "bank_account":   "",
    "bank_ifsc":      "",
    "bank_name":      "",
    "admin_whatsapp": "",
    "support_email":  "",
}


def _get_payment_cfg(db: Session) -> dict:
    row = db.query(SystemSetting).filter(SystemSetting.key == "payment_config").first()
    cfg = row.value if row else {}
    return {**_PAYMENT_DEFAULTS, **cfg}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _notify(db: Session, recipient_id, tenant_id, ntype: str, title: str, body: str, link: str = "/"):
    """Insert an in-app inbox notification. Silently skips if table not ready or tenant_id missing."""
    if not recipient_id or not tenant_id:
        return
    try:
        db.execute(text("""
            INSERT INTO in_app_notifications (tenant_id, recipient_id, type, title, body, link)
            VALUES (:tid, :rid, :type, :title, :body, :link)
        """), {"tid": str(tenant_id), "rid": str(recipient_id),
               "type": ntype, "title": title, "body": body, "link": link})
        db.commit()
    except Exception:
        db.rollback()


def _notify_master_admins(db: Session, title: str, body: str, link: str = "/admin/payments"):
    """Send notification to all master_admin users."""
    admins = db.query(User).filter(User.role == "master_admin").all()
    for a in admins:
        _notify(db, a.id, a.tenant_id, "payment", title, body, link)


def _notify_org_admins(db: Session, tenant_id, title: str, body: str, link: str = "/subscription"):
    """Send notification to all org_admin users of a tenant."""
    admins = db.query(User).filter(User.tenant_id == tenant_id, User.role == "org_admin").all()
    for a in admins:
        _notify(db, a.id, tenant_id, "payment", title, body, link)


def _order_ref() -> str:
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    year   = datetime.now().year
    return f"FG-{year}-{suffix}"


def _calc_amount(plan: Plan, billing_cycle: str) -> int:
    """Return total amount in INR (not paise) for the chosen billing cycle."""
    discount = CYCLE_DISCOUNT.get(billing_cycle, 0)
    months   = CYCLE_MONTHS.get(billing_cycle, 1)
    monthly  = plan.price_inr   # stored in INR directly
    total    = monthly * months
    return int(total * (1 - discount / 100))


def _activate_subscription(db: Session, tenant_id, plan_id: str, billing_cycle: str, amount: int, discount: int):
    """Create or update subscription to active."""
    now    = datetime.now(timezone.utc)
    months = CYCLE_MONTHS.get(billing_cycle, 1)
    end    = now + timedelta(days=30 * months)

    sub = db.query(Subscription).filter(Subscription.tenant_id == tenant_id).first()
    if sub:
        sub.plan_id              = plan_id
        sub.billing_cycle        = billing_cycle
        sub.discount_pct         = discount
        sub.amount_inr           = amount
        sub.status               = "active"
        sub.trial_end            = None
        sub.current_period_start = now
        sub.current_period_end   = end
    else:
        sub = Subscription(
            tenant_id=tenant_id, plan_id=plan_id,
            billing_cycle=billing_cycle, discount_pct=discount, amount_inr=amount,
            status="active", current_period_start=now, current_period_end=end,
        )
        db.add(sub)

    # Mirror plan tier on tenant for quick reads
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if tenant:
        tenant.plan_tier = plan_id
        tenant.subscription_status = "active"

    db.commit()
    return sub


# ── Public / org endpoints ─────────────────────────────────────────────────────

@router.get("/plans")
def list_plans(db: Session = Depends(get_db)):
    """Return all active plans — used by pricing page."""
    plans = db.query(Plan).filter(Plan.is_active == True).order_by(Plan.sort_order).all()
    result = []
    for p in plans:
        result.append({
            "id": p.id, "segment": p.segment, "tier": p.tier, "name": p.name,
            "description": p.description,
            "price_inr": p.price_inr, "price_usd_cents": p.price_usd_cents,
            "submissions_limit": p.submissions_limit, "storage_limit_mb": p.storage_limit_mb,
            "asr_minutes_limit": p.asr_minutes_limit,
            "features": {
                "ai_cleaning": p.ai_cleaning, "ai_writer": p.ai_writer,
                "ai_smart_builder": p.ai_smart_builder, "ai_interpret": p.ai_interpret,
                "ai_analyzer": p.ai_analyzer, "map_view": p.map_view,
                "panel_study": p.panel_study, "spss_export": p.spss_export,
                "api_write": p.api_write, "webhooks": p.webhooks,
                "two_fa": p.two_fa, "sso": p.sso, "audit_log": p.audit_log,
                "advanced_rbac": p.advanced_rbac, "white_label": p.white_label,
                "priority_support": p.priority_support,
            },
            "billing": {
                cycle: {
                    "discount_pct": disc,
                    "months": CYCLE_MONTHS[cycle],
                    "total_inr": _calc_amount(p, cycle),
                    "monthly_effective_inr": (
                        int(_calc_amount(p, cycle) / CYCLE_MONTHS[cycle]) if p.price_inr > 0 else 0
                    ),
                }
                for cycle, disc in CYCLE_DISCOUNT.items()
            },
        })
    return result


class RequestPaymentIn(BaseModel):
    plan_id: str
    billing_cycle: str = "monthly"


@router.post("/request")
def request_payment(body: RequestPaymentIn, user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Create a payment request. Returns UPI/bank details + QR data string."""
    plan = db.query(Plan).filter(Plan.id == body.plan_id, Plan.is_active == True).first()
    if not plan:
        raise HTTPException(404, "Plan not found")
    if plan.tier == "free":
        raise HTTPException(400, "Free plan does not require payment")
    if body.billing_cycle not in CYCLE_DISCOUNT:
        raise HTTPException(400, f"Invalid billing cycle. Choose: {list(CYCLE_DISCOUNT)}")

    amount   = _calc_amount(plan, body.billing_cycle)
    discount = CYCLE_DISCOUNT[body.billing_cycle]
    ref      = _order_ref()
    cfg      = _get_payment_cfg(db)

    existing = db.query(PaymentRequest).filter(
        and_(
            PaymentRequest.tenant_id == user["tenant_id"],
            PaymentRequest.status == "pending",
        )
    ).first()
    if existing:
        plan_obj = db.query(Plan).filter(Plan.id == existing.plan_id).first()
        return _payment_response(existing, plan_obj, cfg)

    req = PaymentRequest(
        order_ref=ref, tenant_id=user["tenant_id"],
        plan_id=body.plan_id, billing_cycle=body.billing_cycle,
        amount_inr=amount, discount_pct=discount,
    )
    db.add(req); db.commit(); db.refresh(req)
    return _payment_response(req, plan, cfg)


def _payment_response(req: PaymentRequest, plan: Plan, cfg: dict):
    upi_id   = cfg.get("upi_id", "")
    upi_name = cfg.get("upi_name", "FieldGovern")
    upi_string = (
        f"upi://pay?pa={upi_id}&pn={upi_name.replace(' ', '%20')}"
        f"&am={req.amount_inr}&cu=INR&tn=FieldGovern%20{req.order_ref}"
    ) if upi_id else ""
    return {
        "order_ref":         req.order_ref,
        "status":            req.status,
        "plan_name":         plan.name,
        "billing_cycle":     req.billing_cycle,
        "amount_inr":        req.amount_inr,
        "discount_pct":      req.discount_pct,
        "upi_string":        upi_string,
        "upi_id":            upi_id,
        "upi_name":          upi_name,
        "bank_account":      cfg.get("bank_account", ""),
        "bank_ifsc":         cfg.get("bank_ifsc", ""),
        "bank_name":         cfg.get("bank_name", ""),
        "admin_whatsapp":    cfg.get("admin_whatsapp", ""),
        "support_email":     cfg.get("support_email", ""),
        "payment_reference": req.order_ref,
        "instructions": [
            f"Pay ₹{req.amount_inr:,} via UPI or bank transfer.",
            f"Mention reference code  {req.order_ref}  in payment description / remarks.",
            "After payment, enter your UTR / transaction number below.",
            "We verify and activate your plan within 2–4 business hours.",
        ],
    }


class SubmitUTRIn(BaseModel):
    order_ref: str
    utr_number: str


@router.post("/utr")
def submit_utr(body: SubmitUTRIn, user=Depends(get_current_user), db: Session = Depends(get_db)):
    """User submits UTR number after making payment."""
    req = db.query(PaymentRequest).filter(
        PaymentRequest.order_ref == body.order_ref,
        PaymentRequest.tenant_id == user["tenant_id"],
    ).first()
    if not req:
        raise HTTPException(404, "Payment request not found")
    if req.status != "pending":
        raise HTTPException(400, f"Request is already {req.status}")

    req.utr_number = body.utr_number.strip()
    db.commit()

    tenant = db.query(Tenant).filter(Tenant.id == req.tenant_id).first()
    plan   = db.query(Plan).filter(Plan.id == req.plan_id).first()
    org_name  = tenant.name if tenant else "An organisation"
    plan_name = plan.name   if plan   else req.plan_id
    _notify_master_admins(
        db,
        title=f"Payment submitted — {org_name}",
        body=f"{org_name} submitted UTR {req.utr_number} for {plan_name} (₹{req.amount_inr:,}). Order: {req.order_ref}",
    )

    return {"message": "UTR submitted. Your plan will be activated within 2–4 business hours.", "order_ref": req.order_ref}


@router.get("/my-subscription")
def my_subscription(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Return current org's subscription + usage."""
    from sqlalchemy import extract
    now = datetime.now(timezone.utc)

    sub  = db.query(Subscription).filter(Subscription.tenant_id == user["tenant_id"]).first()
    plan = db.query(Plan).filter(Plan.id == (sub.plan_id if sub else "ngo_free")).first()

    usage = db.query(UsageRecord).filter(
        UsageRecord.tenant_id == user["tenant_id"],
        UsageRecord.period_year  == now.year,
        UsageRecord.period_month == now.month,
    ).first()

    pending_req = db.query(PaymentRequest).filter(
        PaymentRequest.tenant_id == user["tenant_id"],
        PaymentRequest.status == "pending",
    ).first()

    return {
        "subscription": {
            "plan_id":       sub.plan_id       if sub else "ngo_free",
            "plan_name":     plan.name         if plan else "Free",
            "status":        sub.status        if sub else "active",
            "billing_cycle": sub.billing_cycle if sub else None,
            "period_end":    sub.current_period_end.isoformat() if sub and sub.current_period_end else None,
            "trial_end":     sub.trial_end.isoformat() if sub and sub.trial_end else None,
        },
        "limits": {
            "submissions_limit": plan.submissions_limit if plan else 2000,
            "storage_limit_mb":  plan.storage_limit_mb  if plan else 500,
        },
        "usage": {
            "submissions_used": usage.submissions_used if usage else 0,
            "storage_used_mb":  usage.storage_used_mb  if usage else 0.0,
            "ai_reports_used":  usage.ai_reports_used  if usage else 0,
        },
        "pending_payment": {
            "order_ref":  pending_req.order_ref  if pending_req else None,
            "amount_inr": pending_req.amount_inr if pending_req else None,
            "plan_id":    pending_req.plan_id    if pending_req else None,
        } if pending_req else None,
    }


# ── Payment config endpoints ───────────────────────────────────────────────────

@router.get("/payment-config")
def get_payment_config(db: Session = Depends(get_db)):
    """Public — returns payment config so SubscriptionPage can show QR/bank info."""
    cfg = _get_payment_cfg(db)
    # Never expose sensitive fields publicly — only what users need to pay
    return {
        "upi_id":        cfg["upi_id"],
        "upi_name":      cfg["upi_name"],
        "bank_account":  cfg["bank_account"],
        "bank_ifsc":     cfg["bank_ifsc"],
        "bank_name":     cfg["bank_name"],
        "admin_whatsapp": cfg["admin_whatsapp"],
        "support_email": cfg["support_email"],
        "configured":    bool(cfg["upi_id"] or cfg["bank_account"]),
    }


@router.get("/admin/payment-config")
def admin_get_payment_config(
    user=Depends(require_role("master_admin")),
    db: Session = Depends(get_db),
):
    return _get_payment_cfg(db)


class PaymentConfigIn(BaseModel):
    upi_id:         Optional[str] = None
    upi_name:       Optional[str] = None
    bank_account:   Optional[str] = None
    bank_ifsc:      Optional[str] = None
    bank_name:      Optional[str] = None
    admin_whatsapp: Optional[str] = None
    support_email:  Optional[str] = None


@router.patch("/admin/payment-config")
def admin_update_payment_config(
    body: PaymentConfigIn,
    user=Depends(require_role("master_admin")),
    db: Session = Depends(get_db),
):
    row = db.query(SystemSetting).filter(SystemSetting.key == "payment_config").first()
    current = row.value if row else {}
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    merged  = {**_PAYMENT_DEFAULTS, **current, **updates}
    if row:
        row.value = merged
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(row, "value")
    else:
        db.add(SystemSetting(key="payment_config", value=merged))
    db.commit()
    return merged


# ── master_admin endpoints ─────────────────────────────────────────────────────

@router.get("/admin/requests")
def admin_list_requests(
    status: Optional[str] = None,
    user=Depends(require_role("master_admin")),
    db: Session = Depends(get_db),
):
    """List all payment requests. Filter by status=pending|confirmed|rejected."""
    q = db.query(PaymentRequest)
    if status:
        q = q.filter(PaymentRequest.status == status)
    requests = q.order_by(PaymentRequest.created_at.desc()).all()

    result = []
    for r in requests:
        tenant = db.query(Tenant).filter(Tenant.id == r.tenant_id).first()
        plan   = db.query(Plan).filter(Plan.id == r.plan_id).first()
        result.append({
            "id":           str(r.id),
            "order_ref":    r.order_ref,
            "tenant_id":    str(r.tenant_id),
            "org_name":     tenant.name if tenant else "Unknown",
            "plan_name":    plan.name   if plan   else r.plan_id,
            "billing_cycle": r.billing_cycle,
            "amount_inr":   r.amount_inr,
            "utr_number":   r.utr_number,
            "status":       r.status,
            "confirmed_at": r.confirmed_at.isoformat() if r.confirmed_at else None,
            "rejection_reason": r.rejection_reason,
            "created_at":   r.created_at.isoformat(),
        })
    return result


class ConfirmIn(BaseModel):
    notes: Optional[str] = None


class RejectIn(BaseModel):
    reason: str


@router.patch("/admin/requests/{request_id}/confirm")
def admin_confirm(
    request_id: str,
    body: ConfirmIn = ConfirmIn(),
    user=Depends(require_role("master_admin")),
    db: Session = Depends(get_db),
):
    """Confirm payment → activate subscription immediately."""
    req = db.query(PaymentRequest).filter(PaymentRequest.id == request_id).first()
    if not req:
        raise HTTPException(404, "Request not found")
    if req.status != "pending":
        raise HTTPException(400, f"Request is already {req.status}")
    if not req.utr_number:
        raise HTTPException(400, "Cannot confirm — no UTR has been submitted yet.")

    req.status       = "confirmed"
    req.confirmed_by = user["user_id"]
    req.confirmed_at = datetime.now(timezone.utc)
    if body.notes:
        req.notes    = body.notes
    db.commit()

    _activate_subscription(db, req.tenant_id, req.plan_id, req.billing_cycle, req.amount_inr, req.discount_pct)

    plan = db.query(Plan).filter(Plan.id == req.plan_id).first()
    _notify_org_admins(
        db, req.tenant_id,
        title="Subscription activated!",
        body=f"Your payment of ₹{req.amount_inr:,} has been confirmed. {plan.name if plan else 'Your plan'} is now active.",
    )
    return {"message": f"Payment confirmed. Subscription activated for order {req.order_ref}."}


@router.patch("/admin/requests/{request_id}/reject")
def admin_reject(
    request_id: str,
    body: RejectIn,
    user=Depends(require_role("master_admin")),
    db: Session = Depends(get_db),
):
    req = db.query(PaymentRequest).filter(PaymentRequest.id == request_id).first()
    if not req:
        raise HTTPException(404, "Request not found")
    if req.status != "pending":
        raise HTTPException(400, f"Request is already {req.status}")

    req.status           = "rejected"
    req.confirmed_by     = user["user_id"]
    req.confirmed_at     = datetime.now(timezone.utc)
    req.rejection_reason = body.reason
    db.commit()

    _notify_org_admins(
        db, req.tenant_id,
        title="Payment request rejected",
        body=f"Your payment request ({req.order_ref}) was not approved. Reason: {body.reason}",
    )
    return {"message": "Payment request rejected."}


# ── Subscription overview + manual assign ─────────────────────────────────────

@router.get("/admin/subscriptions")
def admin_list_subscriptions(
    user=Depends(require_role("master_admin")),
    db: Session = Depends(get_db),
):
    """All org subscriptions with plan, status, usage — for master_admin overview."""
    from datetime import timezone as _tz
    now = datetime.now(timezone.utc)
    tenants = db.query(Tenant).all()
    result  = []
    for t in tenants:
        sub   = db.query(Subscription).filter(Subscription.tenant_id == t.id).first()
        plan  = db.query(Plan).filter(Plan.id == (sub.plan_id if sub else "ngo_free")).first()
        usage = db.query(UsageRecord).filter(
            UsageRecord.tenant_id    == t.id,
            UsageRecord.period_year  == now.year,
            UsageRecord.period_month == now.month,
        ).first()
        result.append({
            "tenant_id":    str(t.id),
            "org_name":     t.name,
            "plan_id":      sub.plan_id      if sub  else "ngo_free",
            "plan_name":    plan.name        if plan else "Free",
            "status":       sub.status       if sub  else "none",
            "billing_cycle":sub.billing_cycle if sub else None,
            "period_end":   sub.current_period_end.isoformat() if sub and sub.current_period_end else None,
            "trial_end":    sub.trial_end.isoformat()          if sub and sub.trial_end          else None,
            "submissions_limit": plan.submissions_limit if plan else None,
            "submissions_used":  usage.submissions_used if usage else 0,
        })
    return result


class ManualAssignIn(BaseModel):
    plan_id:       str
    billing_cycle: str = "monthly"
    notes:         Optional[str] = None


@router.post("/admin/subscriptions/{tenant_id}/assign")
def admin_assign_plan(
    tenant_id: str,
    body: ManualAssignIn,
    user=Depends(require_role("master_admin")),
    db: Session = Depends(get_db),
):
    """Manually assign a plan to any org (e.g. after offline payment / override)."""
    import uuid as _uuid
    plan = db.query(Plan).filter(Plan.id == body.plan_id, Plan.is_active == True).first()
    if not plan:
        raise HTTPException(404, "Plan not found")
    if body.billing_cycle not in CYCLE_MONTHS:
        raise HTTPException(400, f"Invalid billing cycle: {list(CYCLE_MONTHS)}")
    try:
        tid = _uuid.UUID(tenant_id)
    except ValueError:
        raise HTTPException(400, "Invalid tenant_id")

    amount   = _calc_amount(plan, body.billing_cycle)
    discount = CYCLE_DISCOUNT.get(body.billing_cycle, 0)
    _activate_subscription(db, tid, body.plan_id, body.billing_cycle, amount, discount)

    _notify_org_admins(
        db, tid,
        title="Plan updated",
        body=f"Your account has been assigned to the {plan.name} plan by the administrator.",
    )
    return {"message": f"Plan {plan.name} assigned to tenant {tenant_id}."}


@router.delete("/admin/subscriptions/{tenant_id}")
def admin_cancel_subscription(
    tenant_id: str,
    user=Depends(require_role("master_admin")),
    db: Session = Depends(get_db),
):
    """Cancel / suspend an org's subscription."""
    import uuid as _uuid
    try:
        tid = _uuid.UUID(tenant_id)
    except ValueError:
        raise HTTPException(400, "Invalid tenant_id")
    sub = db.query(Subscription).filter(Subscription.tenant_id == tid).first()
    if not sub:
        raise HTTPException(404, "No subscription found")
    sub.status = "cancelled"
    db.commit()
    _notify_org_admins(db, tid, title="Subscription cancelled",
        body="Your subscription has been cancelled. Contact support to reactivate.")
    return {"message": "Subscription cancelled."}


# ── Plan limit check helper (used by other routes) ────────────────────────────

def get_org_plan(tenant_id, db: Session) -> Plan:
    """Return the current plan for an org (falls back to free plan)."""
    sub = db.query(Subscription).filter(
        Subscription.tenant_id == tenant_id,
        Subscription.status.in_(["active", "trialing"]),
    ).first()
    plan_id = sub.plan_id if sub else "ngo_free"
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    return plan


def get_org_usage(tenant_id, db: Session) -> UsageRecord:
    """Return or create current month's usage record."""
    now = datetime.now(timezone.utc)
    usage = db.query(UsageRecord).filter(
        UsageRecord.tenant_id    == tenant_id,
        UsageRecord.period_year  == now.year,
        UsageRecord.period_month == now.month,
    ).first()
    if not usage:
        usage = UsageRecord(tenant_id=tenant_id, period_year=now.year, period_month=now.month)
        db.add(usage); db.commit(); db.refresh(usage)
    return usage


def check_submission_limit(tenant_id, db: Session):
    """Raise 402 if org has hit submission limit. Increment on success."""
    plan  = get_org_plan(tenant_id, db)
    usage = get_org_usage(tenant_id, db)
    if plan.submissions_limit and usage.submissions_used >= plan.submissions_limit:
        raise HTTPException(402, f"Submission limit reached ({plan.submissions_limit}/month). Please upgrade your plan.")
    usage.submissions_used += 1
    db.commit()


def check_feature(tenant_id, feature: str, db: Session):
    """Raise 403 if the org's plan doesn't include the feature."""
    plan = get_org_plan(tenant_id, db)
    if plan is None or not getattr(plan, feature, False):
        raise HTTPException(403, f"Feature '{feature}' is not available on your current plan. Please upgrade.")
