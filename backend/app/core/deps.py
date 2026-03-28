"""FastAPI dependencies — auth, tenant context, RBAC."""
from fastapi import Depends, HTTPException, status
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


def get_current_user(
    payload: dict = Depends(_get_token_payload),
    db: Session = Depends(get_db),
) -> dict:
    """Decode JWT and set RLS tenant context on the DB session."""
    tenant_id = payload.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing tenant")
    set_tenant_context(db, tenant_id)
    return payload


def require_role(*roles: str):
    """Dependency factory — raises 403 if user's role is not in allowed list."""
    def _check(user: dict = Depends(get_current_user)):
        if user.get("role") not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user
    return _check


def _get_api_key_payload(credentials: HTTPAuthorizationCredentials = Depends(bearer), db: Session = Depends(get_db)) -> dict:
    """Validate API key and return payload with tenant_id and role."""
    from app.models.api_key import ApiKey
    from sqlalchemy import func

    api_key = credentials.credentials

    # Find the key hash in database
    key_record = db.query(ApiKey).filter(ApiKey.is_active == True).all()

    matching_key = None
    for record in key_record:
        if verify_api_key(api_key, record.key_hash):
            matching_key = record
            break

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
    """Validate API key, set RLS tenant context, and return user payload."""
    tenant_id = payload.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing tenant")
    set_tenant_context(db, tenant_id)
    return payload


# Convenience role guards
require_org_admin   = require_role("master_admin", "org_admin")
require_supervisor  = require_role("master_admin", "org_admin", "supervisor")
require_enumerator  = require_role("master_admin", "org_admin", "supervisor", "enumerator")
