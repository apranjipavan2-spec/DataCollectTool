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
from sqlalchemy import and_

from app.core.database import get_db
from app.core.deps import get_current_user, require_role
from app.models.billing import Plan, Subscription, PaymentRequest, UsageRecord
from app.models.tenant import Tenant
from app.models.user import User

router = APIRouter(prefix="/billing", tags=["billing"])

# ── Constants ──────────────────────────────────────────────────────────────────

CYCLE_DISCOUNT = {"monthly": 0, "6month": 10, "annual": 20, "3year": 30}
CYCLE_MONTHS   = {"monthly": 1, "6month": 6,  "annual": 12, "3year": 36}

# UPI payment details — update these via SystemSetting or env in production
UPI_ID        = "fieldgovernindia@upi"   # replace with actual UPI ID
UPI_NAME      = "FieldGovern Technologies"
BANK_ACCOUNT  = "XXXXXXXXXXXX"           # replace with actual account
BANK_IFSC     = "XXXX0000000"           # replace with actual IFSC
BANK_NAME     = "HDFC Bank"


# ── Helpers ────────────────────────────────────────────────────────────────────

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

    # Check for existing pending request for same tenant+plan
    existing = db.query(PaymentRequest).filter(
        and_(
            PaymentRequest.tenant_id == user["tenant_id"],
            PaymentRequest.status == "pending",
        )
    ).first()
    if existing:
        # Return existing pending request rather than creating duplicate
        plan_obj = db.query(Plan).filter(Plan.id == existing.plan_id).first()
        return _payment_response(existing, plan_obj)

    req = PaymentRequest(
        order_ref=ref, tenant_id=user["tenant_id"],
        plan_id=body.plan_id, billing_cycle=body.billing_cycle,
        amount_inr=amount, discount_pct=discount,
    )
    db.add(req); db.commit(); db.refresh(req)
    return _payment_response(req, plan)


def _payment_response(req: PaymentRequest, plan: Plan):
    upi_string = (
        f"upi://pay?pa={UPI_ID}&pn={UPI_NAME.replace(' ', '%20')}"
        f"&am={req.amount_inr}&cu=INR&tn=FieldGovern%20{req.order_ref}"
    )
    return {
        "order_ref":     req.order_ref,
        "status":        req.status,
        "plan_name":     plan.name,
        "billing_cycle": req.billing_cycle,
        "amount_inr":    req.amount_inr,
        "discount_pct":  req.discount_pct,
        # UPI QR — frontend generates QR from this string
        "upi_string":    upi_string,
        "upi_id":        UPI_ID,
        "upi_name":      UPI_NAME,
        # Bank transfer fallback
        "bank_account":  BANK_ACCOUNT,
        "bank_ifsc":     BANK_IFSC,
        "bank_name":     BANK_NAME,
        "payment_reference": req.order_ref,   # user must mention this in bank transfer
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

    req.status       = "confirmed"
    req.confirmed_by = user["user_id"]
    req.confirmed_at = datetime.now(timezone.utc)
    if body.notes:
        req.notes    = body.notes
    db.commit()

    _activate_subscription(db, req.tenant_id, req.plan_id, req.billing_cycle, req.amount_inr, req.discount_pct)
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
    return {"message": "Payment request rejected."}


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
    if not getattr(plan, feature, False):
        raise HTTPException(403, f"Feature '{feature}' is not available on your current plan. Please upgrade.")
