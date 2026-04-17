"""Reports endpoints.

- POST /reports/digest          — Trigger daily digest for the caller's tenant (admin/supervisor)
- POST /reports/digest/all      — Trigger digest for all tenants (master_admin only)
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_role
from app.services.digest import send_digest_for_tenant, send_digest_all_tenants

logger = logging.getLogger(__name__)
router = APIRouter()

require_master = require_role("master_admin")


@router.post("/digest")
def trigger_digest(
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Manually trigger the daily digest email for the caller's tenant.
    Available to org_admin and supervisor roles.
    """
    if user["role"] not in ("master_admin", "org_admin", "supervisor"):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    result = send_digest_for_tenant(db, str(user["tenant_id"]))
    return result


@router.post("/digest/all")
def trigger_digest_all(
    user=Depends(require_master),
    db: Session = Depends(get_db),
):
    """Trigger the daily digest for ALL tenants (master_admin only)."""
    results = send_digest_all_tenants(db)
    total_sent = sum(r["sent"] for r in results)
    return {"tenants": len(results), "total_sent": total_sent, "details": results}
