"""
Razorpay self-serve payment integration.

Flow:
  1. POST /billing/razorpay/create-order  → creates Razorpay order, returns order_id + key_id
  2. Frontend opens Razorpay checkout with order_id
  3. POST /billing/razorpay/webhook       → Razorpay calls this on payment.captured
  4. Webhook verifies HMAC signature, activates subscription automatically

Existing manual UPI flow is untouched — this is additive.
"""
import hashlib
import hmac
import json
import logging
import uuid as _uuid_mod
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.billing import Plan, Subscription, UsageRecord
from app.models.tenant import Tenant
from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing/razorpay", tags=["razorpay"])

RAZORPAY_API = "https://api.razorpay.com/v1"


def _rzp_auth():
    key_id = settings.RAZORPAY_KEY_ID
    key_secret = settings.RAZORPAY_KEY_SECRET
    if not key_id or not key_secret:
        raise HTTPException(503, "Razorpay is not configured on this server. Use UPI bank transfer instead.")
    return (key_id, key_secret)


def _plan_amount_paise(plan: Plan, billing_cycle: str) -> int:
    """Convert plan price to paise (INR × 100)."""
    cycle_months = {"monthly": 1, "6month": 6, "annual": 12}
    discount_pct = {"monthly": 0, "6month": 10, "annual": 20}
    months = cycle_months.get(billing_cycle, 1)
    discount = discount_pct.get(billing_cycle, 0)
    monthly_inr = int(plan.price_inr_monthly or 0)
    total = monthly_inr * months * (100 - discount) // 100
    return total * 100  # paise


class CreateOrderIn(BaseModel):
    plan_id: str
    billing_cycle: str = "monthly"
    reseller_code: Optional[str] = None


@router.post("/create-order")
def create_razorpay_order(
    body: CreateOrderIn,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a Razorpay order for the requested plan. Returns order_id and publishable key."""
    key_id, key_secret = _rzp_auth()
    plan = db.query(Plan).filter(Plan.id == body.plan_id).first()
    if not plan:
        raise HTTPException(404, "Plan not found")
    amount_paise = _plan_amount_paise(plan, body.billing_cycle)
    if amount_paise <= 0:
        raise HTTPException(400, "Invalid plan amount")

    tenant = db.query(Tenant).filter(Tenant.id == user["tenant_id"]).first()
    # Track reseller referral
    if body.reseller_code and tenant and not tenant.referred_by_reseller_code:
        reseller = db.query(Tenant).filter(Tenant.reseller_code == body.reseller_code).first()
        if reseller and reseller.is_reseller:
            tenant.referred_by_reseller_code = body.reseller_code
            db.commit()

    receipt = f"fg_{str(user['tenant_id'])[:8]}_{_uuid_mod.uuid4().hex[:6]}"
    payload = {
        "amount": amount_paise,
        "currency": "INR",
        "receipt": receipt,
        "notes": {
            "tenant_id": str(user["tenant_id"]),
            "plan_id": body.plan_id,
            "billing_cycle": body.billing_cycle,
            "user_id": str(user.get("id", "")),
        },
    }
    try:
        resp = httpx.post(
            f"{RAZORPAY_API}/orders",
            json=payload,
            auth=(key_id, key_secret),
            timeout=10,
        )
        resp.raise_for_status()
        order = resp.json()
    except httpx.HTTPStatusError as e:
        logger.error("Razorpay order creation failed: %s", e.response.text)
        raise HTTPException(502, "Payment gateway error — please try UPI bank transfer instead.")
    except Exception as e:
        logger.error("Razorpay connection failed: %s", e)
        raise HTTPException(502, "Payment gateway unavailable — please try again.")

    return {
        "order_id": order["id"],
        "amount_paise": amount_paise,
        "currency": "INR",
        "key_id": key_id,
        "plan_name": plan.name,
        "billing_cycle": body.billing_cycle,
    }


@router.post("/webhook")
async def razorpay_webhook(request: Request, db: Session = Depends(get_db)):
    """Razorpay webhook receiver. Verifies HMAC signature and auto-activates subscription."""
    body_bytes = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    key_secret = settings.RAZORPAY_KEY_SECRET
    if not key_secret:
        raise HTTPException(503, "Razorpay not configured")

    # Verify HMAC-SHA256 signature
    expected = hmac.new(
        key_secret.encode(),
        body_bytes,
        hashlib.sha256,
    ).hexdigest()  # type: ignore[attr-defined]
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(400, "Invalid webhook signature")

    try:
        payload = json.loads(body_bytes)
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON")

    event = payload.get("event")
    if event not in ("payment.captured", "order.paid"):
        return {"received": True}

    # Extract notes embedded in the order
    entity = payload.get("payload", {}).get("payment", {}).get("entity", {})
    notes = entity.get("notes", {})
    tenant_id_str = notes.get("tenant_id")
    plan_id = notes.get("plan_id")
    billing_cycle = notes.get("billing_cycle", "monthly")
    amount_paise = entity.get("amount", 0)

    if not tenant_id_str or not plan_id:
        logger.warning("Razorpay webhook missing notes: %s", notes)
        return {"received": True}

    try:
        tenant_id = _uuid_mod.UUID(tenant_id_str)
    except ValueError:
        return {"received": True}

    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not plan or not tenant:
        logger.warning("Razorpay webhook: plan or tenant not found (%s, %s)", plan_id, tenant_id_str)
        return {"received": True}

    # Deactivate old subscriptions
    db.query(Subscription).filter(
        Subscription.tenant_id == tenant_id,
        Subscription.status == "active",
    ).update({"status": "superseded"})

    now = datetime.now(timezone.utc)
    cycle_months = {"monthly": 1, "6month": 6, "annual": 12}
    months = cycle_months.get(billing_cycle, 1)
    end = now.replace(month=((now.month - 1 + months) % 12) + 1,
                      year=now.year + (now.month - 1 + months) // 12)

    sub = Subscription(
        tenant_id=tenant_id,
        plan_id=plan_id,
        status="active",
        billing_cycle=billing_cycle,
        amount_inr=amount_paise // 100,
        discount_pct=0,
        start_date=now,
        end_date=end,
    )
    db.add(sub)

    tenant.plan_tier = plan.tier_name or plan_id
    tenant.subscription_status = "active"

    # Ensure usage record exists
    usage = db.query(UsageRecord).filter(
        UsageRecord.tenant_id == tenant_id,
        UsageRecord.period_year == now.year,
        UsageRecord.period_month == now.month,
    ).first()
    if not usage:
        db.add(UsageRecord(tenant_id=tenant_id, period_year=now.year, period_month=now.month))

    # Audit
    db.add(AuditLog(
        tenant_id=tenant_id,
        action="subscription_activated_razorpay",
        resource="subscription",
        detail={"plan_id": plan_id, "amount_inr": amount_paise // 100, "billing_cycle": billing_cycle},
    ))
    db.commit()
    logger.info("Razorpay: subscription activated for tenant %s plan %s", tenant_id_str, plan_id)
    return {"received": True}
