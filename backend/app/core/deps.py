"""FastAPI dependencies — auth, tenant context, RBAC."""
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from jose import JWTError
from app.core.database import get_db, set_tenant_context
from app.core.security import decode_token, verify_api_key

bearer = HTTPBearer()


def _get_token_payload(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    try:
        return decode_token(credentials.credentials)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def get_current_user(
    request: Request,
    payload: dict = Depends(_get_token_payload),
    db: Session = Depends(get_db),
) -> dict:
    """Decode JWT and set RLS tenant context on the DB session.

    master_admin may pass X-Tenant-ID to INSPECT another tenant's data (read-only).
    Writes are blocked while the override is active so master_admin cannot silently
    create or modify data in a tenant they were only meant to view.
    """
    tenant_id = payload.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing tenant")
    if payload.get("role") == "master_admin":
        override = request.headers.get("X-Tenant-ID")
        if override and override != tenant_id:
            if request.method.upper() in _WRITE_METHODS:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="X-Tenant-ID override is read-only. Remove the header to write in your own tenant.",
                )
            # Scope RLS to the single tenant being inspected (read-only).
            set_tenant_context(db, override)
            return {**payload, "tenant_id": override, "_tenant_override": True}
        # No override: platform-wide access. Empty context = RLS bypass branch, so
        # cross-tenant monitoring dashboards keep working under the restricted role.
        set_tenant_context(db, "")
        return payload
    set_tenant_context(db, tenant_id)
    assert_tenant_active(db, tenant_id)
    return payload


_BLOCKED_STATUSES = ("suspended", "cancelled")


def assert_tenant_active(db: Session, tenant_id) -> None:
    """403 if a master_admin suspended/cancelled this org. Checked per request
    because access tokens don't expire (JWT_EXPIRE_MINUTES=0)."""
    from app.models.tenant import Tenant
    row = db.query(Tenant.subscription_status).filter(Tenant.id == tenant_id).first()
    if row and row[0] in _BLOCKED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This organisation has been suspended. Please contact FieldGovern support.",
        )


def require_role(*roles: str):
    """Dependency factory — raises 403 if user's role is not in allowed list.
    master_admin always passes regardless of the role list."""
    def _check(user: dict = Depends(get_current_user)):
        if user.get("role") == "master_admin" or user.get("role") in roles:
            return user
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    return _check


API_KEY_PREFIX = "fgk_"


def find_api_key(db: Session, presented: str):
    """Return the active ApiKey matching `presented`, or None.

    New keys are "fgk_<key id hex>_<secret>" → one row, one bcrypt check.
    Legacy 32-hex keys (pre 2026-11-04) have no id, so they still scan every
    active key — one bcrypt per row; retire them by issuing new keys."""
    from app.models.api_key import ApiKey
    import uuid as _uuid

    presented = (presented or "").strip()
    if presented.startswith(API_KEY_PREFIX):
        try:
            key_id = _uuid.UUID(presented[len(API_KEY_PREFIX):].split("_", 1)[0])
        except ValueError:
            return None
        rec = db.query(ApiKey).filter(ApiKey.id == key_id, ApiKey.is_active == True).first()
        return rec if rec and verify_api_key(presented, rec.key_hash) else None
    for rec in db.query(ApiKey).filter(ApiKey.is_active == True).all():
        if verify_api_key(presented, rec.key_hash):
            return rec
    return None


def _get_api_key_payload(credentials: HTTPAuthorizationCredentials = Depends(bearer), db: Session = Depends(get_db)) -> dict:
    """Validate API key and return payload with tenant_id and role."""
    from sqlalchemy import func

    matching_key = find_api_key(db, credentials.credentials)

    if not matching_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")

    # Update last_used_at
    matching_key.last_used_at = func.now()
    db.commit()

    # Get creator's role
    from app.models.user import User
    creator = db.query(User).filter(User.id == matching_key.created_by_id).first()
    if not creator:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Key creator no longer exists")

    return {
        "sub": str(creator.id),
        "tenant_id": str(matching_key.tenant_id),
        "role": creator.role,
        "name": creator.name,
        "api_key_id": str(matching_key.id),  # Mark as API key auth
    }


def get_current_user_api_key(
    payload: dict = Depends(_get_api_key_payload),
    db: Session = Depends(get_db),
) -> dict:
    """Validate API key, set RLS tenant context, enforce API call limit, and return user payload."""
    tenant_id = payload.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing tenant")
    set_tenant_context(db, tenant_id)
    assert_tenant_active(db, tenant_id)

    from app.models.tenant import Tenant
    from app.services.plan_enforcement import check_api_calls_limit, increment_api_calls
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if tenant:
        result = check_api_calls_limit(db, tenant_id, tenant.plan_tier)
        if not result["allowed"]:
            raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=result["reason"])
        increment_api_calls(db, tenant_id)

    return payload


# Convenience role guards
# master_admin is platform-level only — he manages tenants via /tenants routes,
# not org-level data (forms, submissions, users). Keeping him out of these guards
# ensures complete tenant isolation.
require_master_admin = require_role("master_admin")
require_org_admin    = require_role("org_admin")
require_supervisor   = require_role("org_admin", "supervisor")
require_enumerator   = require_role("org_admin", "supervisor", "enumerator")
